"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { pdfjs } from "@/lib/pdf/pdfjs";
import type { DocText } from "@/lib/pdf/docText";
import { rangeBoxes, type Box } from "@/lib/highlight";
import { useReader } from "@/lib/store";
import type { PageRange } from "@/lib/tts/chunker";

interface Props {
  pdf: PDFDocumentProxy;
  docText: DocText;
  page: number;
  scale: number;
  /** page size at scale 1 (placeholder until the real size is known) */
  baseSize: { width: number; height: number };
  visible: boolean;
  onTextLayer?: (page: number, divs: HTMLElement[] | null) => void;
  onWordBox?: (el: HTMLElement) => void;
}

const MAX_CANVAS_PIXELS = 16_000_000;
const EMPTY: PageRange[] = [];

/**
 * One page of the original PDF: a canvas with the page exactly as authored,
 * a highlight overlay, and PDF.js's transparent text layer on top (for text
 * selection and click-to-read).
 */
function PageViewImpl({ pdf, docText, page, scale, baseSize, visible, onTextLayer, onWordBox }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(baseSize);
  const [textDivs, setTextDivs] = useState<HTMLElement[] | null>(null);
  const [, setTextVersion] = useState(0);

  // Render canvas + text layer while the page is near the viewport.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !textEl) return;

    (async () => {
      const pg = await pdf.getPage(page);
      if (cancelled) return;
      const vp1 = pg.getViewport({ scale: 1 });
      setSize({ width: vp1.width, height: vp1.height });
      const viewport = pg.getViewport({ scale });

      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (viewport.width * viewport.height * dpr * dpr > MAX_CANVAS_PIXELS) {
        dpr = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
      }
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      renderTask = pg.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });

      const content = await docText.getTextContent(page);
      if (cancelled) return;
      textEl.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: textEl, viewport });
      await textLayer.render();
      if (cancelled) return;
      const divs = textLayer.textDivs as HTMLElement[];
      setTextDivs(divs);
      onTextLayer?.(page, divs);
      await renderTask.promise.catch(() => undefined);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      textEl.replaceChildren();
      canvas.width = 0;
      canvas.height = 0;
      setTextDivs(null);
      onTextLayer?.(page, null);
    };
  }, [pdf, docText, page, scale, visible, onTextLayer]);

  // Re-render highlights when OCR text for this page arrives.
  useEffect(() => {
    const off = docText.onReady((p) => {
      if (p === page) setTextVersion((v) => v + 1);
    });
    return () => {
      off();
    };
  }, [docText, page]);

  const width = size.width * scale;
  const height = size.height * scale;

  return (
    <div
      ref={containerRef}
      data-page={page}
      className="pdf-page relative mx-auto mb-4 bg-white shadow-md"
      style={{ width, height, ["--scale-factor" as string]: scale }}
    >
      {visible && <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden />}
      <HighlightLayer
        page={page}
        docText={docText}
        containerRef={containerRef}
        textDivs={textDivs}
        scale={scale}
        onWordBox={onWordBox}
      />
      <div ref={textRef} className="textLayer" />
      {!visible && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-300">{page}</div>
      )}
    </div>
  );
}

export const PageView = memo(PageViewImpl);

function HighlightLayer({
  page,
  docText,
  containerRef,
  textDivs,
  scale,
  onWordBox,
}: {
  page: number;
  docText: DocText;
  containerRef: React.RefObject<HTMLDivElement | null>;
  textDivs: HTMLElement[] | null;
  scale: number;
  onWordBox?: (el: HTMLElement) => void;
}) {
  const sentence = useReader((s) => (s.sentence.some((r) => r.page === page) ? s.sentence : EMPTY));
  const word = useReader((s) => (s.word.some((r) => r.page === page) ? s.word : EMPTY));
  const [boxes, setBoxes] = useState<{ sentence: Box[]; word: Box[] }>({ sentence: [], word: [] });
  const wordRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const pt = docText.peek(page);
    if (!container || !pt || (!sentence.length && !word.length)) {
      setBoxes({ sentence: [], word: [] });
      return;
    }
    const calc = (ranges: PageRange[]) =>
      ranges.filter((r) => r.page === page).flatMap((r) => rangeBoxes(pt, r.start, r.end, container, textDivs));
    setBoxes({ sentence: calc(sentence), word: calc(word) });
  }, [sentence, word, page, docText, containerRef, textDivs, scale]);

  useEffect(() => {
    if (boxes.word.length && wordRef.current) onWordBox?.(wordRef.current);
  }, [boxes.word, onWordBox]);

  return (
    <div className="hl-layer pointer-events-none absolute inset-0" aria-hidden>
      {boxes.sentence.map((b, i) => (
        <div key={`s${i}`} className="hl-sentence absolute" style={boxStyle(b, 0.25)} />
      ))}
      {boxes.word.map((b, i) => (
        <div
          key={`w${i}`}
          ref={i === 0 ? wordRef : undefined}
          className="hl-word absolute"
          style={boxStyle(b, 0.15)}
        />
      ))}
    </div>
  );
}

function boxStyle(b: Box, pad: number): React.CSSProperties {
  // pad is a fraction of the box height, so highlights breathe a little.
  const padY = b.height * pad;
  return {
    left: `calc(${b.left}% - 2px)`,
    top: `${b.top - padY / 2}%`,
    width: `calc(${b.width}% + 4px)`,
    height: `${b.height + padY}%`,
  };
}
