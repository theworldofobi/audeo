import type { TimedWord } from "./types";

export interface BoundaryEvent {
  /** offset in the chunk text, already mapped back from SSML (-1 if unknown) */
  offset: number;
  /** the word Azure reports */
  text: string;
  /** 100-nanosecond ticks */
  audioOffset: number;
  duration: number;
}

const TICKS_PER_SECOND = 10_000_000;

/**
 * Turns Azure word-boundary events into timed words in chunk coordinates.
 * Uses the reported offset when it matches the text, otherwise searches
 * forward from the previous word (robust to entity/normalization drift).
 */
export function alignWords(text: string, events: BoundaryEvent[]): TimedWord[] {
  const lower = text.toLowerCase();
  const out: TimedWord[] = [];
  let cursor = 0;
  for (const ev of events) {
    const w = ev.text.toLowerCase();
    if (!w.trim()) continue;
    let s = -1;
    if (ev.offset >= cursor && lower.startsWith(w, ev.offset)) {
      s = ev.offset;
    } else {
      const found = lower.indexOf(w, cursor);
      if (found >= 0 && found - cursor < 200) s = found;
      else if (ev.offset >= cursor && ev.offset < text.length) s = ev.offset;
    }
    if (s < 0) continue;
    const e = Math.min(text.length, s + ev.text.length);
    out.push({
      t: ev.audioOffset / TICKS_PER_SECOND,
      d: ev.duration / TICKS_PER_SECOND,
      s,
      e,
    });
    cursor = e;
  }
  return out;
}

const wordSeg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "word" })
    : null;

/** Word ranges of `text` (letters/digits only). */
export function wordRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (wordSeg) {
    for (const s of wordSeg.segment(text)) {
      if (s.isWordLike) out.push([s.index, s.index + s.segment.length]);
    }
  } else {
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
