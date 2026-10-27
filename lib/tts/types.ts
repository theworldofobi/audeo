/** A spoken word with its timing (media seconds) and location in the chunk text. */
export interface TimedWord {
  /** start time, seconds at 1× */
  t: number;
  /** duration, seconds */
  d: number;
  /** char range in chunk text */
  s: number;
  e: number;
}

export interface TtsResponse {
  audioUrl: string;
  words: TimedWord[];
  /** total audio duration in seconds, if known */
  duration?: number;
  cached?: boolean;
  mock?: boolean;
}

export interface Voice {
  id: string;
  label: string;
}

/** Curated Azure neural voices. Any Azure voice name works with /api/tts. */
export const VOICES: Voice[] = [
  { id: "en-US-AvaMultilingualNeural", label: "Ava (US)" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (US)" },
  { id: "en-US-EmmaMultilingualNeural", label: "Emma (US)" },
  { id: "en-US-BrianMultilingualNeural", label: "Brian (US)" },
  { id: "en-US-JennyNeural", label: "Jenny (US)" },
  { id: "en-US-GuyNeural", label: "Guy (US)" },
  { id: "en-US-AriaNeural", label: "Aria (US)" },
  { id: "en-US-DavisNeural", label: "Davis (US)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK)" },
  { id: "en-GB-RyanNeural", label: "Ryan (UK)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (AU)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja (IN)" },
];

export const DEFAULT_VOICE = VOICES[0].id;
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_PRESETS = [1, 1.5, 2, 2.5, 3];
export const MAX_TTS_CHARS = 5000;
