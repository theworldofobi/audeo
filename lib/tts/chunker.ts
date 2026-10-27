// Turns the document (page by page, lazily) into sentence-aligned chunks of
// text for synthesis. A chunk can span a page break when a sentence continues
// onto the next page, so the voice doesn't pause mid-sentence.

import type { PageText } from "@/lib/pdf/textModel";
import { endsSentence, sentences, splitLong, type Range } from "@/lib/pdf/segment";

export interface Position {
  page: number;
  offset: number;
}

/** A slice of one page's text included in a chunk. */
export interface Piece {
  page: number;
  /** range in the page text */
  start: number;
  end: number;
  /** where this piece starts in chunk.text */
  at: number;
}

export interface Chunk {
  key: string;
  text: string;
  pieces: Piece[];
  /** sentence ranges in chunk.text coordinates */
  sentences: Range[];
  /** first position of the chunk */
  start: Position;
  /** where the next chunk starts */
  next: Position | null;
}

/** A position-range on a specific page. */
export interface PageRange {
  page: number;
  start: number;
  end: number;
}

export type PageTextSource = (page: number) => Promise<PageText>;

export const MAX_CHUNK_CHARS = 800;

/**
 * Builds the chunk that starts at `pos`. Pages with no readable text are
 * skipped. Returns null at the end of the document.
 */
export async function buildChunk(
  pos: Position,
  pageCount: number,
  getPage: PageTextSource,
  maxChars = MAX_CHUNK_CHARS,
): Promise<Chunk | null> {
  let page = pos.page;
  let offset = pos.offset;

  // Find the first page (from pos) with at least one sentence.
  let pt: PageText | null = null;
  let sents: Range[] = [];
  while (page <= pageCount) {
    pt = await getPage(page);
    sents = sentences(pt.text, offset).flatMap((r) => splitLong(pt!.text, r, maxChars));
    if (sents.length) break;
    page++;
    offset = 0;
  }
  if (!pt || !sents.length) return null;

  const pieces: Piece[] = [];
  const chunkSents: Range[] = [];
  // Take sentences from this page up to the char budget.
  let taken = 0;
  const pieceStart = sents[0][0];
  let pieceEnd = sents[0][0];
  for (const [s, e] of sents) {
    const add = pt.text.slice(pieceStart, e).length;
    if (taken > 0 && add > maxChars) break;
    chunkSents.push([s - pieceStart, e - pieceStart]);
    pieceEnd = e;
    taken++;
  }
  let text = pt.text.slice(pieceStart, pieceEnd);
  pieces.push({ page, start: pieceStart, end: pieceEnd, at: 0 });

  let next: Position | null;
  if (taken < sents.length) {
    next = { page, offset: sents[taken][0] };
  } else if (page >= pageCount) {
    next = null;
  } else {
    next = { page: page + 1, offset: 0 };
    // Sentence runs over the page break: pull the rest of it from the next page.
    const last = chunkSents[chunkSents.length - 1];
    if (!endsSentence(text.slice(last[0], last[1]))) {
      const np = await getPage(page + 1);
      const nextSents = sentences(np.text, 0);
      if (nextSents.length) {
        const [ns, ne] = nextSents[0];
        if (text.length + (ne - ns) <= maxChars * 1.5) {
          const at = text.length + 1;
          text += " " + np.text.slice(ns, ne);
          pieces.push({ page: page + 1, start: ns, end: ne, at });
          last[1] = text.length;
          next = { page: page + 1, offset: ne };
        }
      }
    }
  }

  return {
    key: `${page}:${pieceStart}:${text.length}`,
    text,
    pieces,
    sentences: chunkSents,
    start: { page, offset: pieceStart },
    next,
  };
}

/** Maps a [start, end) range in chunk.text to one range per page it covers. */
export function chunkRangeToPages(chunk: Chunk, start: number, end: number): PageRange[] {
  const out: PageRange[] = [];
  for (const p of chunk.pieces) {
    const len = p.end - p.start;
    const s = Math.max(start, p.at);
    const e = Math.min(end, p.at + len);
    if (e > s) out.push({ page: p.page, start: p.start + (s - p.at), end: p.start + (e - p.at) });
  }
  return out;
}

/** Converts a chunk text offset to a document position. */
export function chunkOffsetToPosition(chunk: Chunk, offset: number): Position {
  let best = chunk.pieces[0];
  for (const p of chunk.pieces) if (offset >= p.at) best = p;
  return { page: best.page, offset: best.start + Math.max(0, offset - best.at) };
}
