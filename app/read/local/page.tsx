"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LazyReader } from "@/components/reader/LazyReader";

/** Read a PDF straight from this device — nothing is uploaded or saved. */
export default function LocalReaderPage() {
  const [file, setFile] = useState<File | null>(null);
  const source = useMemo(() => (file ? { file } : null), [file]);

  if (source && file) return <LazyReader source={source} title={file.name} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6">
      <Link href="/" className="text-3xl font-black tracking-tight text-violet-700">
        audeo
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Open a PDF from this device</h1>
      <p className="mt-2 text-neutral-600">
        The file stays on your device and progress isn&apos;t saved. Sign in to keep a synced library.
      </p>
      <label className="mt-8 block cursor-pointer rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-10 text-center hover:border-violet-400">
        <span className="text-lg font-semibold">Choose a PDF</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          data-testid="local-file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
    </main>
  );
}
