/**
 * Edge TTS voice + speaking-style catalog for the Homebridge config UI.
 * Styles map to Microsoft Edge rate/pitch (same idea as homebridge-homepod-israel-hebrew).
 */

export interface VoiceOption {
  id: string;
  /** Full Edge neural voice name. */
  voice: string;
  title: string;
  language: string;
}

export interface StyleOption {
  id: string;
  title: string;
  rate?: string;
  pitch?: string;
}

export const DEFAULT_VOICE_ID = 'hila';
export const DEFAULT_STYLE_ID = 'normal';

/** Curated Edge voices (Hebrew + multilingual + common English). */
export const VOICES: VoiceOption[] = [
  { id: 'hila', voice: 'he-IL-HilaNeural', title: 'Hila (Hebrew · female)', language: 'he-IL' },
  { id: 'avri', voice: 'he-IL-AvriNeural', title: 'Avri (Hebrew · male)', language: 'he-IL' },
  { id: 'ava', voice: 'en-US-AvaMultilingualNeural', title: 'Ava (multilingual · female)', language: 'en-US' },
  { id: 'emma', voice: 'en-US-EmmaMultilingualNeural', title: 'Emma (multilingual · female)', language: 'en-US' },
  { id: 'andrew', voice: 'en-US-AndrewMultilingualNeural', title: 'Andrew (multilingual · male)', language: 'en-US' },
  { id: 'brian', voice: 'en-US-BrianMultilingualNeural', title: 'Brian (multilingual · male)', language: 'en-US' },
  { id: 'jenny', voice: 'en-US-JennyNeural', title: 'Jenny (English · female)', language: 'en-US' },
  { id: 'guy', voice: 'en-US-GuyNeural', title: 'Guy (English · male)', language: 'en-US' },
  { id: 'aria', voice: 'en-US-AriaNeural', title: 'Aria (English · female)', language: 'en-US' },
  { id: 'davis', voice: 'en-US-DavisNeural', title: 'Davis (English · male)', language: 'en-US' },
  { id: 'sara', voice: 'en-US-SaraNeural', title: 'Sara (English · female)', language: 'en-US' },
  { id: 'tony', voice: 'en-US-TonyNeural', title: 'Tony (English · male)', language: 'en-US' },
];

/**
 * Speaking styles. Edge TTS approximates these with rate/pitch
 * (Gemini-style prompt engines do more, but this plugin is Edge-only).
 */
export const STYLES: StyleOption[] = [
  { id: 'normal', title: 'Normal' },
  { id: 'cheerful', title: 'Cheerful', rate: '+12%', pitch: '+12Hz' },
  { id: 'calm', title: 'Calm & quiet', rate: '-18%', pitch: '-6Hz' },
  { id: 'whisper', title: 'Whisper', rate: '-15%', pitch: '-10Hz' },
  { id: 'announcer', title: 'Announcer', rate: '-6%', pitch: '-4Hz' },
  { id: 'urgent', title: 'Urgent warning', rate: '+18%', pitch: '+6Hz' },
  { id: 'warm', title: 'Warm & loving', rate: '-8%', pitch: '+2Hz' },
  { id: 'excited', title: 'Excited', rate: '+20%', pitch: '+18Hz' },
  { id: 'funny', title: 'Playful / funny', rate: '+5%', pitch: '+8Hz' },
];

const VOICE_BY_ID = new Map(VOICES.map((item) => [item.id, item]));
const VOICE_BY_NAME = new Map(VOICES.map((item) => [item.voice.toLowerCase(), item]));
const STYLE_BY_ID = new Map(STYLES.map((item) => [item.id, item]));

export interface ResolvedVoice {
  id: string;
  voice: string;
  language: string;
  style: string;
  rate: string;
  pitch: string;
}

/**
 * Resolve a UI voice id, legacy Edge voice name, or raw Neural name + style id.
 */
export function resolveVoice(voiceIdOrName?: string, styleId?: string): ResolvedVoice {
  const style = STYLE_BY_ID.get((styleId || DEFAULT_STYLE_ID).trim()) || STYLE_BY_ID.get(DEFAULT_STYLE_ID)!;
  const raw = (voiceIdOrName || DEFAULT_VOICE_ID).trim();
  const byId = VOICE_BY_ID.get(raw.toLowerCase()) || VOICE_BY_ID.get(raw);
  if (byId) {
    return {
      id: byId.id,
      voice: byId.voice,
      language: byId.language,
      style: style.id,
      rate: style.rate || 'default',
      pitch: style.pitch || 'default',
    };
  }
  const byName = VOICE_BY_NAME.get(raw.toLowerCase());
  if (byName) {
    return {
      id: byName.id,
      voice: byName.voice,
      language: byName.language,
      style: style.id,
      rate: style.rate || 'default',
      pitch: style.pitch || 'default',
    };
  }
  // Raw Edge voice name (e.g. he-IL-HilaNeural) from older configs.
  if (/Neural$/i.test(raw)) {
    const languageMatch = /^([a-z]{2}-[A-Z]{2})-/.exec(raw);
    return {
      id: raw,
      voice: raw,
      language: languageMatch ? languageMatch[1] : 'en-US',
      style: style.id,
      rate: style.rate || 'default',
      pitch: style.pitch || 'default',
    };
  }
  return resolveVoice(DEFAULT_VOICE_ID, style.id);
}

/** Homebridge config.schema.json oneOf entries for voices. */
export function voiceSchemaOneOf(): Array<{ title: string; enum: [string] }> {
  return VOICES.map((item) => ({ title: item.title, enum: [item.id] }));
}

/** Homebridge config.schema.json oneOf entries for styles. */
export function styleSchemaOneOf(): Array<{ title: string; enum: [string] }> {
  return STYLES.map((item) => ({ title: item.title, enum: [item.id] }));
}
