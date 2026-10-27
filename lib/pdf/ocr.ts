"use client";

import type { PDFPageProxy } from "pdfjs-dist";
import type { Worker } from "tesseract.js";
import type { OcrWord } from "./textModel";

export interface OcrResult {
  words: OcrWord[];
  /** indexes of words that start a new paragraph */
  paraStarts: number[];
}

const TARGET_WIDTH = 2000; // px; enough resolution for book-sized text

/** In-browser OCR with Tesseract.js. One worker, jobs run one at a time. */
export class OcrEngine {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Promise<Worker> {
    this.worker ??= import("tesseract.js").then(({ createWorker }) =>
      createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        gzip: true,
      }),
    );
    return this.worker;
  }

  recognize(page: PDFPageProxy): Promise<OcrResult> {
    const job = this.queue.then(() => this.run(page));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async run(page: PDFPageProxy): Promise<OcrResult> {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      await page.render({ canvas, viewport }).promise;
      const worker = await this.getWorker();
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      const paraStarts: number[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          if (words.length) paraStarts.push(words.length);
          for (const line of para.lines) {
            for (const w of line.words) {
              const text = w.text.trim();
              if (!text || w.confidence < 30) continue;
              words.push({
                text,
                x0: w.bbox.x0 / canvas.width,
                y0: w.bbox.y0 / canvas.height,
                x1: w.bbox.x1 / canvas.width,
                y1: w.bbox.y1 / canvas.height,
              });
            }
          }
        }
      }
      return { words, paraStarts };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async destroy() {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w).terminate();
  }
}
