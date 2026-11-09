import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { Announcer } from './announcer';
import type { HomePodAnnouncePlatform } from './platform';

export interface AnnouncementConfig {
  name: string;
  text: string;
  homepodId?: string;
  volume?: number;
  voice?: string;
  style?: string;
}

/**
 * Momentary switch: On → speak text on HomePod → Off.
 * Works in the Home app and in automations/scenes.
 */
export class AnnounceAccessory {
  private readonly switchService: Service;
  private busy = false;
  private on = false;

  constructor(
    private readonly platform: HomePodAnnouncePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly announcement: AnnouncementConfig,
    private readonly announcer: Announcer,
  ) {
    const { Characteristic, Service } = this.platform;

    this.accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'HomePod Announcements')
      .setCharacteristic(Characteristic.Model, 'TTS Switch')
      .setCharacteristic(Characteristic.SerialNumber, slug(announcement.name));

    this.switchService = this.accessory.getService(Service.Switch)
      || this.accessory.addService(Service.Switch, announcement.name);
    this.switchService.setCharacteristic(Characteristic.Name, announcement.name);
    this.switchService.getCharacteristic(Characteristic.On)
      .onGet(() => this.on)
      .onSet((value) => this.setOn(value));
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const requested = Boolean(value);
    if (!requested) {
      this.on = false;
      return;
    }
    if (this.busy) {
      this.platform.log.warn(`[${this.announcement.name}] already announcing — ignoring`);
      this.on = true;
      setTimeout(() => this.turnOff(), 250);
      return;
    }

    this.busy = true;
    this.on = true;
    this.platform.log.info(
      `[${this.announcement.name}] announcing: ${JSON.stringify(this.announcement.text)}`,
    );
    try {
      await this.announcer.speak({
        text: this.announcement.text,
        homepodId: this.announcement.homepodId,
        volume: this.announcement.volume,
        voice: this.announcement.voice,
        style: this.announcement.style,
      });
      this.platform.log.info(`[${this.announcement.name}] done`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`[${this.announcement.name}] ${message}`);
    } finally {
      this.busy = false;
      this.turnOff();
    }
  }

  private turnOff(): void {
    this.on = false;
    this.switchService.updateCharacteristic(this.platform.Characteristic.On, false);
  }
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'announce';
}
