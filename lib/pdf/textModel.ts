// Builds a readable page string from PDF.js text items while remembering, for
// every character, which text item (and which char inside it) it came from.
// That map lets us turn "the voice is at chars 120–126 of page 4" back into
// the exact glyphs on the original page.

export interface RawTextItem {
  str: string;
  hasEOL: boolean;
  /** PDF transform matrix [a, b, c, d, e, f]; e/f are the x/y origin. */
  transform: number[];
  width: number;
  height: number;
}

/** A word box in page-relative fractions (0..1), used for OCR'd pages. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageText {
  page: number;
  text: string;
  kind: "pdf" | "ocr";
  /** For each char of `text`: index of its source item/word, or -1 for synthetic separators. */
  itemIdx: Int32Array;
  /** For each char of `text`: char offset inside the source item/word. */
  itemOff: Int32Array;
  /** Only for kind === "ocr". */
  words?: OcrWord[];
}

const HYPHENS = new Set(["-", "­", "‐"]);
const LETTER = /\p{L}/u;

/** Characters PDFs use that sound wrong or break segmentation. */
function normalizeChar(ch: string): string {
  switch (ch) {
    case " ":
    case " ":
    case " ":
    case " ":
    case "\t":
      return " ";
    case "ﬁ":
      return "fi"; // only reached when the ligature wasn't decomposed upstream
    default:
      return ch;
  }
}

export function buildPdfPageText(page: number, items: RawTextItem[]): PageText {
  const chars: string[] = [];
  const idx: number[] = [];
  const off: number[] = [];

  const push = (ch: string, i: number, o: number) => {
    for (const c of normalizeChar(ch)) {
      chars.push(c);
      idx.push(i);
      off.push(o);
    }
  };
  const lastChar = () => (chars.length ? chars[chars.length - 1] : "");

  let prev: RawTextItem | null = null;
  // Last item with a real glyph height, for paragraph/heading detection.
  let prevSized: RawTextItem | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const str = item.str;

    if (prev && chars.length) {
      const startsWithSpace = str.length > 0 && /\s/.test(str[0]);
      const endsWithSpace = /\s/.test(lastChar());
      // A new paragraph or heading ends the sentence even without punctuation.
      const block = str.trim().length > 0 && prevSized !== null && blockBreak(prevSized, item);
      if (prev.hasEOL) {
        // Line break: join "exam-\nple" → "example", otherwise add a space.
        const l = lastChar();
        const beforeHyphen = chars.length > 1 ? chars[chars.length - 2] : "";
        if (!block && HYPHENS.has(l) && LETTER.test(beforeHyphen) && str.length > 0 && /\p{Ll}/u.test(str[0])) {
          chars.pop();
          idx.pop();
          off.pop();
        } else if (block) {
          push("\n", -1, 0);
        } else if (!endsWithSpace && !startsWithSpace) {
          push(" ", -1, 0);
        }
      } else if (block) {
        push("\n", -1, 0);
      } else if (!endsWithSpace && !startsWithSpace && str.length > 0) {
        if (needsGapSpace(prev, item)) push(" ", -1, 0);
      }
    }

    for (let o = 0; o < str.length; o++) push(str[o], i, o);
    if (str.length > 0 || item.hasEOL) prev = item;
    if (str.trim().length > 0 && item.height > 0) prevSized = item;
  }

  return {
    page,
    text: chars.join(""),
    kind: "pdf",
    itemIdx: Int32Array.from(idx),
    itemOff: Int32Array.from(off),
  };
}

/** True when `b` starts a new block: a bigger-than-line vertical gap or a change of font size. */
function blockBreak(a: RawTextItem, b: RawTextItem): boolean {
  const ha = a.height;
  const hb = b.height;
  if (!ha || !hb) return false;
  const h = Math.max(ha, hb);
  const dy = Math.abs((a.transform[5] ?? 0) - (b.transform[5] ?? 0));
  if (dy < h * 0.5) return false; // same line
  if (dy > h * 1.8) return true;
  return h / Math.min(ha, hb) > 1.25;
}

/** True when two consecutive items are visually separated (new line or a horizontal gap). */
function needsGapSpace(a: RawTextItem, b: RawTextItem): boolean {
  const ax = a.transform[4] ?? 0;
  const ay = a.transform[5] ?? 0;
  const bx = b.transform[4] ?? 0;
  const by = b.transform[5] ?? 0;
  const h = Math.max(a.height, b.height, 1);
  if (Math.abs(ay - by) > h * 0.5) return true; // different line
  const gap = bx - (ax + a.width);
  return gap > h * 0.15;
}

/** `paraStarts`: indexes of words that begin a new paragraph (a sentence break). */
export function buildOcrPageText(page: number, words: OcrWord[], paraStarts: Set<number>): PageText {
  const chars: string[] = [];
  const idx: number[] = [];
  const off: number[] = [];
  words.forEach((w, i) => {
    if (i > 0) {
      chars.push(paraStarts.has(i) ? "\n" : " ");
      idx.push(-1);
      off.push(0);
    }
    for (let o = 0; o < w.text.length; o++) {
      chars.push(w.text[o]);
      idx.push(i);
      off.push(o);
    }
  });
  return {
    page,
    text: chars.join(""),
    kind: "ocr",
    itemIdx: Int32Array.from(idx),
    itemOff: Int32Array.from(off),
    words,
  };
}

/** A contiguous run of characters that lives in one source item. */
export interface ItemSlice {
  item: number;
  start: number;
  /** exclusive */
  end: number;
}

/** Splits page-text range [start, end) into per-item slices (separators are skipped). */
export function sliceByItem(pt: PageText, start: number, end: number): ItemSlice[] {
  const out: ItemSlice[] = [];
  const s = Math.max(0, start);
  const e = Math.min(pt.text.length, end);
  let cur: ItemSlice | null = null;
  for (let c = s; c < e; c++) {
    const it = pt.itemIdx[c];
    if (it < 0) continue;
    const o = pt.itemOff[c];
    // `o <= cur.end` also absorbs ligatures that expand to several chars.
    if (cur && cur.item === it && o >= cur.start && o <= cur.end) {
      cur.end = Math.max(cur.end, o + 1);
    } else {
      cur = { item: it, start: o, end: o + 1 };
      out.push(cur);
    }
  }
  return out;
}

/** Count of non-whitespace chars; used to detect pages that need OCR. */
export function visibleCharCount(text: string): number {
  let n = 0;
  for (const ch of text) if (!/\s/.test(ch)) n++;
  return n;
}
