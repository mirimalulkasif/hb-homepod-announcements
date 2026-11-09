import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_STYLE_ID, DEFAULT_VOICE_ID, resolveVoice } from './voices';

// Bundled with the plugin — no system edge-tts / espeak install required.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EdgeTTS } = require('node-edge-tts') as {
  EdgeTTS: new (options?: {
    voice?: string;
    lang?: string;
    outputFormat?: string;
    rate?: string;
    pitch?: string;
    timeout?: number;
  }) => { ttsPromise: (text: string, filepath: string) => Promise<void> };
};

export interface AnnounceOptions {
  text: string;
  /** pyatv device id / MAC / name (from `atvremote scan`). */
  homepodId?: string;
  volume?: number;
  /** Voice id (hila, avri, …) or full Edge name (he-IL-HilaNeural). */
  voice?: string;
  /** Style id: normal, whisper, announcer, funny, … */
  style?: string;
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
  /** Default voice id or Edge voice name. */
  voice?: string;
  /** Default speaking style id. */
  style?: string;
  language?: string;
  /** Plugin install root (for vendor/pyatv). Defaults to package root. */
  pluginRoot?: string;
  /** homepod-radio HTTP play base, e.g. http://127.0.0.1:7654/play */
  homepodRadioPlayBase?: string;
  /** Writable media folder for homepod-radio. */
  mediaPath?: string;
  log?: (message: string) => void;
  exec?: ExecFn;
  fetch?: FetchFn;
  which?: (binary: string) => Promise<string | undefined>;
  /** Test hook — skip real Edge TTS. */
  synthesizeToFile?: (
    text: string,
    outPath: string,
    voice?: string,
    language?: string,
    rate?: string,
    pitch?: string,
  ) => Promise<void>;
}

/**
 * Speaks text on a HomePod using bundled Edge TTS, then streams via
 * vendor pyatv (`atvremote`) or homebridge-homepod-radio `/play`.
 */
export class ShellAnnouncer implements Announcer {
  private readonly log: (message: string) => void;
  private readonly exec: ExecFn;
  private readonly fetch: FetchFn;
  private readonly which: (binary: string) => Promise<string | undefined>;
  private readonly playback: 'auto' | 'pyatv' | 'homepod-radio';
  private readonly defaultHomepodId?: string;
  private readonly defaultVolume: number;
  private readonly defaultVoice: string;
  private readonly defaultStyle: string;
  private readonly defaultLanguage?: string;
  private readonly radioPlayBase: string;
  private readonly mediaPath: string;
  private readonly pluginRoot: string;
  private readonly synthesizeToFile?: ShellAnnouncerOptions['synthesizeToFile'];

  constructor(options: ShellAnnouncerOptions = {}) {
    this.log = options.log || (() => undefined);
    this.exec = options.exec || defaultExec;
    this.fetch = options.fetch || defaultFetch;
    this.which = options.which || defaultWhich;
    this.playback = options.playback || 'auto';
    this.defaultHomepodId = options.homepodId;
    this.defaultVolume = clampVolume(options.volume ?? 50);
    this.defaultVoice = options.voice?.trim() || DEFAULT_VOICE_ID;
    this.defaultStyle = options.style?.trim() || DEFAULT_STYLE_ID;
    this.defaultLanguage = options.language;
    this.radioPlayBase = options.homepodRadioPlayBase || 'http://127.0.0.1:7654/play';
    this.mediaPath = options.mediaPath || '/var/www/tones';
    this.pluginRoot = options.pluginRoot || join(__dirname, '..');
    this.synthesizeToFile = options.synthesizeToFile;
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
    const mp3 = join(tmpdir(), `hb-announce-${process.pid}-${Date.now()}.mp3`);
    const resolved = resolveVoice(
      options.voice || this.defaultVoice,
      options.style || this.defaultStyle,
    );
    const language = options.language || this.defaultLanguage || resolved.language;

    if (this.synthesizeToFile) {
      await this.synthesizeToFile(text, mp3, resolved.voice, language, resolved.rate, resolved.pitch);
      return mp3;
    }

    this.log(
      `TTS (bundled Edge) voice=${resolved.voice} style=${resolved.style}`
        + ` rate=${resolved.rate} pitch=${resolved.pitch} lang=${language}`,
    );
    const tts = new EdgeTTS({
      voice: resolved.voice,
      lang: language,
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      rate: resolved.rate,
      pitch: resolved.pitch,
      timeout: 20_000,
    });
    await tts.ttsPromise(text, mp3);
    return mp3;
  }

  private async play(audioPath: string, options: AnnounceOptions): Promise<void> {
    const mode = await this.resolvePlayback();
    const homepodId = options.homepodId || this.defaultHomepodId;
    const volume = clampVolume(options.volume ?? this.defaultVolume);

    if (mode === 'homepod-radio') {
      await this.playViaRadio(audioPath, volume);
      return;
    }

    const atvremote = await this.resolveAtvremote();
    if (!atvremote) {
      throw new Error(
        'atvremote not found. Reinstall the plugin (postinstall sets up vendor/pyatv), or install homebridge-homepod-radio and set playback to homepod-radio.',
      );
    }
    if (!homepodId) {
      throw new Error(
        'homepodId is required for pyatv playback (from `atvremote scan`).',
      );
    }

    this.log(`Play pyatv (${atvremote}) id=${homepodId} volume=${volume}`);
    await this.exec(atvremote, [
      '--id',
      homepodId,
      'set_volume=' + String(volume),
    ]).catch(() => undefined);
    await this.exec(atvremote, ['--id', homepodId, `stream_file=${audioPath}`]);
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
    if (await this.resolveAtvremote()) {
      return 'pyatv';
    }
    try {
      await fs.access(this.mediaPath);
      return 'homepod-radio';
    } catch {
      return 'pyatv';
    }
  }

  private async resolveAtvremote(): Promise<string | undefined> {
    const vendor = join(
      this.pluginRoot,
      'vendor',
      'pyatv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'atvremote.exe' : 'atvremote',
    );
    try {
      await fs.access(vendor);
      return vendor;
    } catch {
      // fall through
    }
    return this.which('atvremote');
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

async function defaultWhich(binary: string): Promise<string | undefined> {
  try {
    const { stdout } = await defaultExec('which', [binary]);
    const path = stdout.trim().split('\n')[0];
    return path || undefined;
  } catch {
    return undefined;
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
