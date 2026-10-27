"use client";

import type { PageText } from "@/lib/pdf/textModel";
import { sliceByItem } from "@/lib/pdf/textModel";

/** A highlight box in page-relative percentages, so it survives zooming. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Computes boxes covering page-text range [start, end) on the original page.
 * For text PDFs we measure DOM Ranges over PDF.js text-layer spans; for OCR
 * pages we use Tesseract's word boxes.
 */
export function rangeBoxes(
  pt: PageText,
  start: number,
  end: number,
  container: HTMLElement,
  textDivs: HTMLElement[] | null,
): Box[] {
  const slices = sliceByItem(pt, start, end);
  const out: Box[] = [];

  if (pt.kind === "ocr") {
    for (const sl of slices) {
      const w = pt.words?.[sl.item];
      if (!w) continue;
      out.push({ left: w.x0 * 100, top: w.y0 * 100, width: (w.x1 - w.x0) * 100, height: (w.y1 - w.y0) * 100 });
    }
    return mergeBoxes(out);
  }

  if (!textDivs) return [];
  const cr = container.getBoundingClientRect();
  if (!cr.width || !cr.height) return [];
  const range = document.createRange();
  for (const sl of slices) {
    const span = textDivs[sl.item];
    const node = span?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const len = node.textContent?.length ?? 0;
    const s = Math.min(sl.start, len);
    const e = Math.min(sl.end, len);
    if (e <= s) continue;
    range.setStart(node, s);
    range.setEnd(node, e);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      out.push({
        left: ((r.left - cr.left) / cr.width) * 100,
        top: ((r.top - cr.top) / cr.height) * 100,
        width: (r.width / cr.width) * 100,
        height: (r.height / cr.height) * 100,
      });
    }
  }
  return mergeBoxes(out);
}

/** Joins boxes on the same line so a sentence reads as one continuous band. */
export function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    if (last) {
      const sameLine =
        Math.abs(last.top - b.top) < Math.max(last.height, b.height) * 0.5 &&
        Math.abs(last.height - b.height) < Math.max(last.height, b.height) * 0.6;
      const gap = b.left - (last.left + last.width);
      if (sameLine && gap > -last.height * 2 && gap < Math.max(last.height, b.height) * 1.5) {
        const left = Math.min(last.left, b.left);
        const right = Math.max(last.left + last.width, b.left + b.width);
        const top = Math.min(last.top, b.top);
        const bottom = Math.max(last.top + last.height, b.top + b.height);
        Object.assign(last, { left, top, width: right - left, height: bottom - top });
        continue;
      }
    }
    out.push({ ...b });
  }
  return out;
}

/** Finds the page-text offset under a click, or -1. */
export function offsetAtPoint(
  pt: PageText,
  x: number,
  y: number,
  container: HTMLElement,
  textDivs: HTMLElement[] | null,
): number {
  if (pt.kind === "ocr") {
    const cr = container.getBoundingClientRect();
    const fx = (x - cr.left) / cr.width;
    const fy = (y - cr.top) / cr.height;
    let best = -1;
    let bestDist = Infinity;
    pt.words?.forEach((w, i) => {
      const dx = fx < w.x0 ? w.x0 - fx : fx > w.x1 ? fx - w.x1 : 0;
      const dy = fy < w.y0 ? w.y0 - fy : fy > w.y1 ? fy - w.y1 : 0;
      const d = dx * dx + dy * dy * 4;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0 || bestDist > 0.002) return -1;
    return findOffset(pt, best, 0);
  }

  if (!textDivs) return -1;
  const hit = caretAt(x, y);
  if (!hit) return -1;
  const span = hit.node.nodeType === Node.TEXT_NODE ? hit.node.parentElement : (hit.node as HTMLElement);
  const item = span ? textDivs.indexOf(span) : -1;
  if (item < 0) return -1;
  return findOffset(pt, item, hit.offset);
}

function findOffset(pt: PageText, item: number, off: number): number {
  let best = -1;
  for (let c = 0; c < pt.text.length; c++) {
    if (pt.itemIdx[c] !== item) continue;
    best = c;
    if (pt.itemOff[c] >= off) return c;
  }
  return best;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}
