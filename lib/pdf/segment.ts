// Sentence segmentation and sentence-aligned chunking for synthesis.

export type Range = [start: number, end: number];

const sentenceSeg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "sentence" })
    : null;

/** Returns sentence ranges of `text` starting at `from`, trimmed, skipping blank ones. */
export function sentences(text: string, from = 0): Range[] {
  const sub = text.slice(from);
  const out: Range[] = [];
  const raw: Range[] = [];
  if (sentenceSeg) {
    for (const s of sentenceSeg.segment(sub)) raw.push([s.index, s.index + s.segment.length]);
  } else {
    const re = /[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sub))) raw.push([m.index, m.index + m[0].length]);
  }
  for (let [s, e] of raw) {
    while (s < e && /\s/.test(sub[s])) s++;
    while (e > s && /\s/.test(sub[e - 1])) e--;
    if (e > s && /[\p{L}\p{N}]/u.test(sub.slice(s, e))) out.push([s + from, e + from]);
  }
  return mergeAbbreviations(text, out);
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|Vol|pp|cf|al)\.$/i;

/** Intl.Segmenter splits after "Dr." / "e.g."; glue those back to the next sentence. */
function mergeAbbreviations(text: string, ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && ABBREV.test(text.slice(last[0], last[1]))) {
      last[1] = r[1];
    } else {
      out.push([r[0], r[1]]);
    }
  }
  return out;
}

/** Splits an over-long sentence at word boundaries into pieces of at most `max` chars. */
export function splitLong(text: string, [s, e]: Range, max: number): Range[] {
  if (e - s <= max) return [[s, e]];
  const out: Range[] = [];
  let start = s;
  while (e - start > max) {
    let cut = start + max;
    while (cut > start + max / 2 && !/\s/.test(text[cut])) cut--;
    if (cut <= start + max / 2) cut = start + max;
    let end = cut;
    while (end > start && /\s/.test(text[end - 1])) end--;
    out.push([start, end]);
    start = cut;
    while (start < e && /\s/.test(text[start])) start++;
  }
  if (e > start) out.push([start, e]);
  return out;
}

/** True if a sentence looks finished (so a page break after it is a real break). */
export function endsSentence(s: string): boolean {
  return /[.!?:;…]["'”’)\]]*$/.test(s.trimEnd());
}

/** Binary search: index of the last entry whose `key(entry) <= value`, or -1. */
export function lastAtOrBefore<T>(arr: readonly T[], value: number, key: (t: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= value) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
