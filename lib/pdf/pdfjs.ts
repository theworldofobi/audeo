"use client";

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

export { pdfjs };

export type PdfSource = { url: string } | { file: File };

/**
 * Opens a PDF. URLs are read with HTTP range requests and no auto-fetch, so
 * only the bytes for pages actually viewed/read are downloaded — this is what
 * makes giant PDFs open quickly.
 */
export function openPdf(source: PdfSource): PDFDocumentLoadingTask {
  const common = {
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    isEvalSupported: false,
  };
  if ("url" in source) {
    return pdfjs.getDocument({
      ...common,
      url: source.url,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 512 * 1024,
    });
  }
  // Local files: hand pdf.js the bytes lazily via a range transport over the Blob.
  const file = source.file;
  const transport = new pdfjs.PDFDataRangeTransport(file.size, null);
  transport.requestDataRange = (begin: number, end: number) => {
    void file
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)));
  };
  return pdfjs.getDocument({
    ...common,
    range: transport,
    disableAutoFetch: true,
    rangeChunkSize: 512 * 1024,
  });
}
