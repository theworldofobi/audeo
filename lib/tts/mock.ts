// Development stand-in for Azure: silent audio + evenly paced word timings,
// so the reader and highlighting can be built and tested without a key.

import { wordRanges } from "./align";
import type { TimedWord } from "./types";

const SAMPLE_RATE = 8000;
const SECONDS_PER_CHAR = 0.06; // ~165 wpm at 1×

export function mockSynthesize(text: string): { audio: Buffer; words: TimedWord[]; duration: number } {
  const words: TimedWord[] = [];
  let t = 0.1;
  for (const [s, e] of wordRanges(text)) {
    const d = Math.max(0.12, (e - s) * SECONDS_PER_CHAR + 0.08);
    words.push({ t, d, s, e });
    t += d + 0.04;
  }
  const duration = t + 0.2;
  return { audio: silentWav(duration), words, duration };
}

function silentWav(seconds: number): Buffer {
  const samples = Math.ceil(seconds * SAMPLE_RATE);
  const buf = Buffer.alloc(44 + samples);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE, 28); // byte rate (8-bit mono)
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44); // 8-bit PCM silence is 0x80
  return buf;
}
