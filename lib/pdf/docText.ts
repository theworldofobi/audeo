"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { OcrEngine, type OcrResult } from "./ocr";
import { buildOcrPageText, buildPdfPageText, visibleCharCount, type PageText } from "./textModel";

/** Pages with fewer visible characters than this are treated as scanned. */
const OCR_THRESHOLD = 20;
const CACHE_PAGES = 80;

export interface OcrStore {
  load(page: number): Promise<OcrResult | null>;
  save(page: number, result: OcrResult): Promise<void>;
}

/**
 * Lazily extracts (and caches) the readable text of each page. The same
 * TextContent object is shared with the on-screen text layer so character
 * offsets map 1:1 to the rendered spans.
 */
export class DocText {
  private content = new Map<number, Promise<TextContent>>();
  private pages = new Map<number, Promise<PageText>>();
  private ready = new Map<number, PageText>();
  private ocr: OcrEngine | null;
  private listeners = new Set<(page: number) => void>();

  constructor(
    private pdf: PDFDocumentProxy,
    private opts: { ocr?: boolean; ocrStore?: OcrStore } = {},
  ) {
    this.ocr = opts.ocr === false ? null : new OcrEngine();
  }

  get pageCount() {
    return this.pdf.numPages;
  }

  getTextContent(page: number): Promise<TextContent> {
    let p = this.content.get(page);
    if (!p) {
      p = this.pdf.getPage(page).then((pg) => pg.getTextContent());
      this.content.set(page, p);
      p.catch(() => this.content.delete(page));
      trim(this.content);
    }
    return p;
  }

  /** Text for a page, if it has already been extracted (no OCR is started). */
  peek(page: number): PageText | null {
    return this.ready.get(page) ?? null;
  }

  /** Fires when a page's text becomes available (useful for OCR pages). */
  onReady(fn: (page: number) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getPage(page: number): Promise<PageText> {
    let p = this.pages.get(page);
    if (!p) {
      p = this.load(page).then((pt) => {
        this.ready.set(page, pt);
        trim(this.ready);
        for (const l of this.listeners) l(page);
        return pt;
      });
      this.pages.set(page, p);
      p.catch(() => this.pages.delete(page));
      trim(this.pages);
    }
    return p;
  }

  private async load(page: number): Promise<PageText> {
    const tc = await this.getTextContent(page);
    const items = tc.items.filter((i): i is TextItem => "str" in i);
    const pdfText = buildPdfPageText(page, items);
    if (!this.ocr || visibleCharCount(pdfText.text) >= OCR_THRESHOLD) return pdfText;

    let result = await this.opts.ocrStore?.load(page).catch(() => null);
    if (!result) {
      result = await this.ocr.recognize(await this.pdf.getPage(page));
      this.opts.ocrStore?.save(page, result).catch(() => undefined);
    }
    const ocrText = buildOcrPageText(page, result.words, new Set(result.paraStarts ?? []));
    return visibleCharCount(ocrText.text) > visibleCharCount(pdfText.text) ? ocrText : pdfText;
  }

  destroy() {
    this.listeners.clear();
    void this.ocr?.destroy();
  }
}

function trim<K, V>(map: Map<K, V>) {
  while (map.size > CACHE_PAGES) map.delete(map.keys().next().value as K);
}
