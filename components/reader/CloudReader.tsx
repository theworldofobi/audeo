"use client";

import { useMemo, useRef } from "react";
import type { OcrStore } from "@/lib/pdf/docText";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { DocumentRow } from "@/lib/supabase/config";
import type { Position } from "@/lib/tts/chunker";
import { LazyReader } from "./LazyReader";

const SAVE_DELAY_MS = 1500;

/** Reader for a document in the user's cloud library: saves progress and OCR results. */
export function CloudReader({ doc, url }: { doc: DocumentRow; url: string }) {
  const source = useMemo(() => ({ url }), [url]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ocrStore = useMemo<OcrStore>(
    () => ({
      async load(page) {
        const { data } = await supabaseBrowser()
          .from("ocr_pages")
          .select("words")
          .eq("document_id", doc.id)
          .eq("page", page)
          .maybeSingle();
        return (data?.words as Awaited<ReturnType<OcrStore["load"]>>) ?? null;
      },
      async save(page, result) {
        await supabaseBrowser()
          .from("ocr_pages")
          .upsert({
            document_id: doc.id,
            page,
            text: result.words.map((w) => w.text).join(" "),
            words: result,
          });
      },
    }),
    [doc.id],
  );

  const initial = useMemo(
    () => ({
      position: { page: doc.last_page || 1, offset: doc.last_offset || 0 } satisfies Position,
      rate: doc.rate,
      voice: doc.voice,
    }),
    [doc],
  );

  const onProgress = useMemo(
    () => (p: { position: Position; rate: number; voice: string }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void supabaseBrowser()
          .from("documents")
          .update({ last_page: p.position.page, last_offset: p.position.offset, rate: p.rate, voice: p.voice })
          .eq("id", doc.id);
      }, SAVE_DELAY_MS);
    },
    [doc.id],
  );

  const onPageCount = useMemo(
    () => (n: number) => {
      if (doc.page_count !== n) {
        void supabaseBrowser().from("documents").update({ page_count: n }).eq("id", doc.id);
      }
    },
    [doc.id, doc.page_count],
  );

  return (
    <LazyReader
      source={source}
      title={doc.title}
      initial={initial}
      ocrStore={ocrStore}
      onProgress={onProgress}
      onPageCount={onPageCount}
    />
  );
}
