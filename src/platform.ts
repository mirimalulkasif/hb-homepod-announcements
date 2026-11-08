import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { FakeAnnouncer, ShellAnnouncer, type Announcer } from './announcer';
import { AnnounceAccessory, type AnnouncementConfig } from './accessory';
import { AnnounceHttpServer } from './http-server';
import { DEFAULT_HTTP_PORT, DEFAULT_VOLUME, PLATFORM_NAME, PLUGIN_NAME } from './settings';

export class HomePodAnnouncePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly ready: Promise<void>;
  public readonly handlers: AnnounceAccessory[] = [];

  private readonly accessories: PlatformAccessory[] = [];
  private readonly announcer: Announcer;
  private http?: AnnounceHttpServer;
  private resolveReady!: () => void;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
    announcerFactory?: (platform: HomePodAnnouncePlatform) => Announcer,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    this.announcer = announcerFactory
      ? announcerFactory(this)
      : new ShellAnnouncer({
        playback: normalizePlayback(this.config.playback),
        homepodId: stringOrUndefined(this.config.homepodId),
        volume: numberOr(this.config.volume, DEFAULT_VOLUME),
        voice: stringOrUndefined(this.config.voice),
        language: stringOrUndefined(this.config.language),
        homepodRadioPlayBase: stringOrUndefined(this.config.homepodRadioPlayBase),
        mediaPath: stringOrUndefined(this.config.mediaPath),
        log: (message) => this.log.info(message),
      });

    this.api.on('didFinishLaunching', () => {
      this.discover();
      this.startHttp();
      this.resolveReady();
    });
    this.api.on('shutdown', () => {
      this.http?.stop();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private discover(): void {
    const announcements = this.readAnnouncements();
    const active = new Set<string>();

    for (const announcement of announcements) {
      const uuid = this.api.hap.uuid.generate(`homepod-announce:${announcement.name}`);
      active.add(uuid);
      const existing = this.accessories.find((item) => item.UUID === uuid);
      const accessory = existing || new this.api.platformAccessory(announcement.name, uuid);
      accessory.context.announcement = announcement;

      const handler = new AnnounceAccessory(this, accessory, announcement, this.announcer);
      this.handlers.push(handler);

      if (existing) {
        this.log.info(`Restoring switch "${announcement.name}"`);
      } else {
        this.log.info(`Adding switch "${announcement.name}"`);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }
    }

    const stale = this.accessories.filter((item) => !active.has(item.UUID));
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private startHttp(): void {
    const port = numberOr(this.config.httpPort, DEFAULT_HTTP_PORT);
    if (port <= 0) {
      return;
    }
    this.http = new AnnounceHttpServer({
      port,
      announcer: this.announcer,
      defaultHomepodId: stringOrUndefined(this.config.homepodId),
      defaultVolume: numberOr(this.config.volume, DEFAULT_VOLUME),
      defaultVoice: stringOrUndefined(this.config.voice),
      log: (message) => this.log.info(message),
    });
    this.http.start();
  }

  private readAnnouncements(): AnnouncementConfig[] {
    const raw = Array.isArray(this.config.announcements) ? this.config.announcements : [];
    const result: AnnouncementConfig[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const item = entry as Record<string, unknown>;
      const name = String(item.name ?? '').trim();
      const text = String(item.text ?? '').trim();
      if (!name || !text) {
        this.log.error('Each announcement needs a name and text');
        continue;
      }
      result.push({
        name,
        text,
        homepodId: stringOrUndefined(item.homepodId),
        volume: item.volume != null ? numberOr(item.volume, DEFAULT_VOLUME) : undefined,
        voice: stringOrUndefined(item.voice),
      });
    }
    return result;
  }
}

/** Test helper — platform with a FakeAnnouncer and no network. */
export function createTestPlatform(
  log: Logger,
  config: PlatformConfig,
  api: API,
  fake = new FakeAnnouncer(),
): { platform: HomePodAnnouncePlatform; fake: FakeAnnouncer } {
  const platform = new HomePodAnnouncePlatform(log, config, api, () => fake);
  return { platform, fake };
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePlayback(value: unknown): 'auto' | 'pyatv' | 'homepod-radio' {
  if (value === 'pyatv' || value === 'homepod-radio' || value === 'auto') {
    return value;
  }
  return 'auto';
}
