import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AnnounceOptions {
  text: string;
  /** pyatv device id / MAC / name (from `atvremote scan`). */
  homepodId?: string;
  volume?: number;
  /** edge-tts voice, e.g. en-US-JennyNeural or he-IL-HilaNeural. */
  voice?: string;
  language?: string;
}

export interface Announcer {
  speak(options: AnnounceOptions): Promise<void>;
}

export type ExecFn = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ShellAnnouncerOptions {
  /** Preferred playback: auto | pyatv | homepod-radio */
  playback?: 'auto' | 'pyatv' | 'homepod-radio';
  /** Default HomePod id for pyatv. */
  homepodId?: string;
  /** Default volume 0–100. */
  volume?: number;
  /** Default edge-tts / espeak voice. */
  voice?: string;
  language?: string;
  /** homepod-radio HTTP play base, e.g. http://127.0.0.1:7654/play */
  homepodRadioPlayBase?: string;
  /** Writable media folder for homepod-radio. */
  mediaPath?: string;
  log?: (message: string) => void;
  exec?: ExecFn;
  fetch?: FetchFn;
  which?: (binary: string) => Promise<boolean>;
}

/**
 * Speaks text on a HomePod: synthesize audio locally, then stream via
 * pyatv (`atvremote stream_file`) or homebridge-homepod-radio `/play`.
 */
export class ShellAnnouncer implements Announcer {
  private readonly log: (message: string) => void;
  private readonly exec: ExecFn;
  private readonly fetch: FetchFn;
  private readonly which: (binary: string) => Promise<boolean>;
  private readonly playback: 'auto' | 'pyatv' | 'homepod-radio';
  private readonly defaultHomepodId?: string;
  private readonly defaultVolume: number;
  private readonly defaultVoice?: string;
  private readonly defaultLanguage?: string;
  private readonly radioPlayBase: string;
  private readonly mediaPath: string;

  constructor(options: ShellAnnouncerOptions = {}) {
    this.log = options.log || (() => undefined);
    this.exec = options.exec || defaultExec;
    this.fetch = options.fetch || defaultFetch;
    this.which = options.which || defaultWhich;
    this.playback = options.playback || 'auto';
    this.defaultHomepodId = options.homepodId;
    this.defaultVolume = clampVolume(options.volume ?? 50);
    this.defaultVoice = options.voice;
    this.defaultLanguage = options.language;
    this.radioPlayBase = options.homepodRadioPlayBase || 'http://127.0.0.1:7654/play';
    this.mediaPath = options.mediaPath || '/var/www/tones';
  }

  async speak(options: AnnounceOptions): Promise<void> {
    const text = options.text.trim();
    if (!text) {
      throw new Error('Announcement text is empty');
    }

    const audioPath = await this.synthesize(text, options);
    try {
      await this.play(audioPath, options);
    } finally {
      await fs.unlink(audioPath).catch(() => undefined);
    }
  }

  private async synthesize(text: string, options: AnnounceOptions): Promise<string> {
    const outBase = join(tmpdir(), `hb-announce-${process.pid}-${Date.now()}`);
    const voice = options.voice || this.defaultVoice;
    const language = options.language || this.defaultLanguage;

    if (await this.which('edge-tts')) {
      const mp3 = `${outBase}.mp3`;
      const args = ['--text', text, '--write-media', mp3];
      if (voice) {
        args.push('--voice', voice);
      }
      this.log(`TTS edge-tts → ${mp3}`);
      await this.exec('edge-tts', args);
      return mp3;
    }

    if (await this.which('espeak-ng')) {
      const wav = `${outBase}.wav`;
      const args = ['-w', wav];
      if (voice) {
        args.push('-v', voice);
      } else if (language) {
        args.push('-v', language);
      }
      args.push(text);
      this.log(`TTS espeak-ng → ${wav}`);
      await this.exec('espeak-ng', args);
      return wav;
    }

    if (await this.which('espeak')) {
      const wav = `${outBase}.wav`;
      const args = ['-w', wav];
      if (voice) {
        args.push('-v', voice);
      } else if (language) {
        args.push('-v', language);
      }
      args.push(text);
      this.log(`TTS espeak → ${wav}`);
      await this.exec('espeak', args);
      return wav;
    }

    if (await this.which('say')) {
      const aiff = `${outBase}.aiff`;
      const args = ['-o', aiff];
      if (voice) {
        args.push('-v', voice);
      }
      args.push(text);
      this.log(`TTS say → ${aiff}`);
      await this.exec('say', args);
      return aiff;
    }

    throw new Error(
      'No TTS engine found. Install edge-tts (`pip install edge-tts`) or espeak-ng, then restart Homebridge.',
    );
  }

  private async play(audioPath: string, options: AnnounceOptions): Promise<void> {
    const mode = await this.resolvePlayback();
    const homepodId = options.homepodId || this.defaultHomepodId;
    const volume = clampVolume(options.volume ?? this.defaultVolume);

    if (mode === 'homepod-radio') {
      await this.playViaRadio(audioPath, volume);
      return;
    }

    if (!homepodId) {
      throw new Error(
        'homepodId is required for pyatv playback (from `atvremote scan`). Or install homebridge-homepod-radio and set playback to auto/homepod-radio.',
      );
    }
    if (!(await this.which('atvremote'))) {
      throw new Error('atvremote not found. Install pyatv (`pip install pyatv`) and ensure it is on PATH.');
    }

    this.log(`Play pyatv id=${homepodId} volume=${volume} file=${audioPath}`);
    await this.exec('atvremote', [
      '--id',
      homepodId,
      'set_volume=' + String(volume),
    ]).catch(() => undefined);
    await this.exec('atvremote', ['--id', homepodId, `stream_file=${audioPath}`]);
  }

  private async playViaRadio(audioPath: string, volume: number): Promise<void> {
    await fs.mkdir(this.mediaPath, { recursive: true });
    const fileName = `announce-${process.pid}-${Date.now()}${extOf(audioPath)}`;
    const dest = join(this.mediaPath, fileName);
    await fs.copyFile(audioPath, dest);
    const url = `${this.radioPlayBase.replace(/\/$/, '')}?file=${encodeURIComponent(fileName)}&volume=${volume}`;
    this.log(`Play homepod-radio ${url}`);
    const response = await this.fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`homepod-radio play failed HTTP ${response.status}: ${await response.text()}`);
    }
  }

  private async resolvePlayback(): Promise<'pyatv' | 'homepod-radio'> {
    if (this.playback === 'pyatv') {
      return 'pyatv';
    }
    if (this.playback === 'homepod-radio') {
      return 'homepod-radio';
    }
    try {
      await fs.access(this.mediaPath);
      return 'homepod-radio';
    } catch {
      return 'pyatv';
    }
  }
}

/** Test double that records speak() calls. */
export class FakeAnnouncer implements Announcer {
  readonly calls: AnnounceOptions[] = [];
  failWith?: Error;

  async speak(options: AnnounceOptions): Promise<void> {
    this.calls.push({ ...options });
    if (this.failWith) {
      throw this.failWith;
    }
  }
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extOf(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path);
  return match ? match[0] : '.wav';
}

async function defaultExec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function defaultWhich(binary: string): Promise<boolean> {
  try {
    await defaultExec('which', [binary]);
    return true;
  } catch {
    return false;
  }
}

async function defaultFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
}
