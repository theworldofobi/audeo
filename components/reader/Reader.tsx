"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf, type PdfSource } from "@/lib/pdf/pdfjs";
import { DocText, type OcrStore } from "@/lib/pdf/docText";
import { sentences } from "@/lib/pdf/segment";
import { offsetAtPoint } from "@/lib/highlight";
import { useReader } from "@/lib/store";
import { Narrator, clampRate } from "@/lib/tts/narrator";
import type { Position } from "@/lib/tts/chunker";
import { DEFAULT_VOICE, type TtsResponse } from "@/lib/tts/types";
import { PageView } from "./PageView";
import { PlayerBar } from "./PlayerBar";

export interface ReaderProps {
  source: PdfSource;
  title: string;
  initial?: { position?: Position; rate?: number; voice?: string | null };
  ocrStore?: OcrStore;
  onProgress?: (p: { position: Position; rate: number; voice: string }) => void;
  onPageCount?: (n: number) => void;
}

async function fetchTts(text: string, voice: string): Promise<TtsResponse> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Voice service error (${res.status})`);
  }
  return res.json();
}

export default function Reader({ source, title, initial, ocrStore, onProgress, onPageCount }: ReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [docText, setDocText] = useState<DocText | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerWidth, setViewerWidth] = useState(800);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1, 2]));
  const [pageInput, setPageInput] = useState("");
  const viewerRef = useRef<HTMLDivElement>(null);
  const narratorRef = useRef<Narrator | null>(null);
  const textDivsRef = useRef(new Map<number, HTMLElement[] | null>());
  const visibleRef = useRef(visible);
  const followRef = useRef(true);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    progressRef.current = onProgress;
  }, [onProgress]);

  const zoom = useReader((s) => s.zoom);
  const follow = useReader((s) => s.follow);
  const currentPage = useReader((s) => s.currentPage);
  const error = useReader((s) => s.error);
  const set = useReader((s) => s.set);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior = "smooth") => {
    const el = viewerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    el?.scrollIntoView({ block: "start", behavior });
  }, []);

  // Reset per-document UI state.
  useEffect(() => {
    set({
      playing: false,
      loading: false,
      ended: false,
      sentence: [],
      word: [],
      follow: true,
      zoom: 1,
      currentPage: initial?.position?.page ?? 1,
      error: null,
      rate: clampRate(initial?.rate ?? 1),
      voice: initial?.voice || DEFAULT_VOICE,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Open the PDF.
  useEffect(() => {
    let cancelled = false;
    let dt: DocText | null = null;
    const task = openPdf(source);
    task.promise
      .then(async (d) => {
        if (cancelled) return;
        const p1 = await d.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        dt = new DocText(d, { ocrStore });
        if (cancelled) return;
        setBaseSize({ width: vp.width, height: vp.height });
        setDocText(dt);
        setPdf(d);
        onPageCount?.(d.numPages);
      })
      .catch((e) => !cancelled && setLoadError(e?.message ?? "Could not open this PDF"));
    return () => {
      cancelled = true;
      dt?.destroy();
      void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Fit-to-width scale.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdf]);
  const fit = Math.min(Math.max(viewerWidth - 32, 200), 980) / baseSize.width;
  const scale = Math.round(fit * zoom * 1000) / 1000;

  // Create the narrator.
  useEffect(() => {
    if (!pdf || !docText) return;
    const s = useReader.getState();
    const n = new Narrator({
      pageCount: pdf.numPages,
      getPage: (p) => docText.getPage(p),
      fetchTts,
      voice: s.voice,
      rate: s.rate,
      onState: (st) => useReader.getState().set(st),
      onError: (msg) => useReader.getState().set({ error: msg }),
      onHighlight: (h) => {
        const st = useReader.getState();
        st.set({ sentence: h?.sentence ?? [], word: h?.word ?? [] });
        if (!h) return;
        progressRef.current?.({ position: h.position, rate: st.rate, voice: st.voice });
        const page = h.word[0]?.page ?? h.sentence[0]?.page;
        // Bring an off-screen page into view so it renders and the word can be followed.
        if (followRef.current && page && !visibleRef.current.has(page)) scrollToPage(page, "auto");
      },
    });
    if (initial?.position) n.setStart(initial.position);
    narratorRef.current = n;
    (window as unknown as { __audeo?: Narrator }).__audeo = n; // handy for debugging/e2e
    return () => {
      n.destroy();
      narratorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, docText]);

  // Jump to the saved page once the document is ready.
  useEffect(() => {
    if (pdf && initial?.position && initial.position.page > 1) {
      requestAnimationFrame(() => scrollToPage(initial.position!.page, "auto"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // Virtualisation: only pages near the viewport get a canvas + text layer.
  useEffect(() => {
    const root = viewerRef.current;
    if (!root || !pdf) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          visibleRef.current = next;
          return next;
        });
      },
      { root, rootMargin: "120% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pdf]);

  // Track the page in view (for the page counter).
  useEffect(() => {
    const root = viewerRef.current;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = root.getBoundingClientRect();
        const el = document
          .elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.35)
          ?.closest<HTMLElement>("[data-page]");
        if (el) useReader.getState().set({ currentPage: Number(el.dataset.page) });
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [pdf]);

  // Manual scrolling pauses auto-follow.
  useEffect(() => {
    const root = viewerRef.current;
    if (!root) return;
    const stop = () => {
      if (!followRef.current || !useReader.getState().playing) return;
      followRef.current = false;
      useReader.getState().set({ follow: false });
    };
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("touchmove", stop, { passive: true });
    return () => {
      root.removeEventListener("wheel", stop);
      root.removeEventListener("touchmove", stop);
    };
  }, [pdf]);

  const onWordBox = useCallback((el: HTMLElement) => {
    const root = viewerRef.current;
    if (!root || !followRef.current) return;
    const r = el.getBoundingClientRect();
    const v = root.getBoundingClientRect();
    if (r.top < v.top + 60 || r.bottom > v.bottom - 100) {
      root.scrollBy({ top: r.top - v.top - v.height * 0.35, behavior: "smooth" });
    }
  }, []);

  const backToVoice = useCallback(() => {
    followRef.current = true;
    useReader.getState().set({ follow: true });
    const el = viewerRef.current?.querySelector<HTMLElement>(".hl-word, .hl-sentence");
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    else {
      const page = useReader.getState().sentence[0]?.page;
      if (page) scrollToPage(page);
    }
  }, [scrollToPage]);

  const onTextLayer = useCallback((page: number, divs: HTMLElement[] | null) => {
    textDivsRef.current.set(page, divs);
  }, []);

  // Click a sentence to start reading there.
  const onViewerClick = useCallback(
    async (e: React.MouseEvent) => {
      const n = narratorRef.current;
      if (!n || !docText) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
      if (!pageEl) return;
      const page = Number(pageEl.dataset.page);
      const { clientX, clientY } = e;
      const pt = await docText.getPage(page);
      const off = offsetAtPoint(pt, clientX, clientY, pageEl, textDivsRef.current.get(page) ?? null);
      if (off < 0) return;
      const sent = sentences(pt.text).find(([s, end]) => off >= s && off < end) ?? null;
      followRef.current = true;
      useReader.getState().set({ follow: true });
      await n.playFrom({ page, offset: sent ? sent[0] : off });
    },
    [docText],
  );

  const onRate = useCallback((r: number) => {
    const v = clampRate(r);
    narratorRef.current?.setRate(v);
    const st = useReader.getState();
    st.set({ rate: v });
    const pos = narratorRef.current?.position;
    if (pos) progressRef.current?.({ position: pos, rate: v, voice: st.voice });
  }, []);

  const onVoice = useCallback((v: string) => {
    useReader.getState().set({ voice: v });
    void narratorRef.current?.setVoice(v);
  }, []);

  const toggle = useCallback(() => {
    followRef.current = true;
    useReader.getState().set({ follow: true, error: null });
    narratorRef.current?.toggle();
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [contenteditable]")) return;
      const n = narratorRef.current;
      if (!n) return;
      const st = useReader.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) n.skip(10);
          else void n.nextSentence();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) n.skip(-10);
          else void n.prevSentence();
          break;
        case "ArrowUp":
          e.preventDefault();
          onRate(st.rate + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          onRate(st.rate - 0.1);
          break;
        case "+":
        case "=":
          st.set({ zoom: Math.min(3, st.zoom + 0.1) });
          break;
        case "-":
          st.set({ zoom: Math.max(0.5, st.zoom - 0.1) });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, onRate]);

  const pages = useMemo(() => (pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : []), [pdf]);

  return (
    <div className="flex h-dvh flex-col bg-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <Link href="/library" className="text-lg font-bold tracking-tight text-violet-700">
          audeo
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-700" title={title}>
          {title}
        </h1>
        {pdf && (
          <form
            className="flex items-center gap-1 text-sm text-neutral-600"
            onSubmit={(e) => {
              e.preventDefault();
              const p = Math.min(pdf.numPages, Math.max(1, Number(pageInput) || 1));
              setPageInput("");
              scrollToPage(p, "auto");
            }}
          >
            <span>p.</span>
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              placeholder={String(currentPage)}
              className="w-14 rounded border border-neutral-300 px-1.5 py-0.5 text-center tabular-nums"
              aria-label="Go to page"
            />
            <span className="tabular-nums">/ {pdf.numPages}</span>
          </form>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-8 w-8 rounded hover:bg-neutral-100"
            onClick={() => set({ zoom: Math.max(0.5, zoom - 0.1) })}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-neutral-500">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="h-8 w-8 rounded hover:bg-neutral-100"
            onClick={() => set({ zoom: Math.min(3, zoom + 0.1) })}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </header>

      <div ref={viewerRef} className="relative flex-1 overflow-auto px-4 py-6" onClick={onViewerClick}>
        {loadError && (
          <div className="mx-auto max-w-md rounded-lg bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
        )}
        {!pdf && !loadError && (
          <div className="mx-auto mt-24 h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
        )}
        {pdf &&
          docText &&
          pages.map((p) => (
            <PageView
              key={p}
              pdf={pdf}
              docText={docText}
              page={p}
              scale={scale}
              baseSize={baseSize}
              visible={visible.has(p)}
              onTextLayer={onTextLayer}
              onWordBox={onWordBox}
            />
          ))}
      </div>

      {!follow && (
        <button
          type="button"
          onClick={backToVoice}
          className="fixed bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          Back to voice
        </button>
      )}
      {error && (
        <div className="fixed bottom-28 right-4 z-10 max-w-sm rounded-lg bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => set({ error: null })}>
            Dismiss
          </button>
        </div>
      )}

      <PlayerBar
        onToggle={toggle}
        onPrev={() => void narratorRef.current?.prevSentence()}
        onNext={() => void narratorRef.current?.nextSentence()}
        onSkip={(s) => narratorRef.current?.skip(s)}
        onRate={onRate}
        onVoice={onVoice}
      />
    </div>
  );
}
