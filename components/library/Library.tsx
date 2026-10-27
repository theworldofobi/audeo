"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PDF_BUCKET, SUPABASE_URL, type DocumentRow } from "@/lib/supabase/config";

interface Props {
  userId: string;
  email: string;
  initialDocs: DocumentRow[];
  loadError: string | null;
}

interface Uploading {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

// Supabase's resumable endpoint requires exactly 6 MB chunks.
const CHUNK = 6 * 1024 * 1024;

export function Library({ userId, email, initialDocs, loadError }: Props) {
  const [docs, setDocs] = useState(initialDocs);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchUpload = (key: string, patch: Partial<Uploading>) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const uploadFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return;
      const supabase = supabaseBrowser();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;

      // Reuse the same document id if this exact file was partially uploaded before (resume).
      const fp = `audeo-upload:${file.name}:${file.size}:${file.lastModified}`;
      let id = safeGet(fp);
      if (!id) {
        id = crypto.randomUUID();
        safeSet(fp, id);
      }
      const path = `${userId}/${id}.pdf`;
      const key = id;
      setUploads((u) => [...u.filter((x) => x.key !== key), { key, name: file.name, progress: 0 }]);

      const upload = new Upload(file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${token}`, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK,
        metadata: {
          bucketName: PDF_BUCKET,
          objectName: path,
          contentType: "application/pdf",
          cacheControl: "3600",
        },
        onProgress: (sent, total) => patchUpload(key, { progress: total ? sent / total : 0 }),
        onError: (err) => patchUpload(key, { error: friendlyUploadError(err) }),
        onSuccess: async () => {
          const title = file.name.replace(/\.pdf$/i, "");
          const { data, error } = await supabase
            .from("documents")
            .upsert({ id, user_id: userId, title, storage_path: path, size_bytes: file.size })
            .select()
            .single();
          safeRemove(fp);
          if (error) {
            patchUpload(key, { error: error.message });
            return;
          }
          setUploads((u) => u.filter((x) => x.key !== key));
          setDocs((d) => [data as DocumentRow, ...d.filter((x) => x.id !== id)]);
        },
      });
      const previous = await upload.findPreviousUploads();
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    },
    [userId],
  );

  const onFiles = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) void uploadFile(f);
  };

  const remove = async (doc: DocumentRow) => {
    if (!confirm(`Delete “${doc.title}”?`)) return;
    const supabase = supabaseBrowser();
    await supabase.storage.from(PDF_BUCKET).remove([doc.storage_path]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (!error) setDocs((d) => d.filter((x) => x.id !== doc.id));
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-2xl font-black tracking-tight text-violet-700">audeo</span>
          <div className="flex items-center gap-4 text-sm text-neutral-600">
            <span className="hidden sm:inline">{email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded-full border border-neutral-300 px-3 py-1 hover:bg-neutral-50">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
            dragging ? "border-violet-500 bg-violet-50" : "border-neutral-300 bg-white hover:border-violet-400"
          }`}
        >
          <p className="text-lg font-semibold">Drop PDFs here or click to upload</p>
          <p className="mt-1 text-sm text-neutral-500">Any size. Uploads resume if your connection drops.</p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {uploads.length > 0 && (
          <ul className="mt-6 space-y-2">
            {uploads.map((u) => (
              <li key={u.key} className="rounded-lg bg-white p-3 text-sm shadow-sm">
                <div className="flex justify-between">
                  <span className="truncate">{u.name}</span>
                  <span className={u.error ? "text-red-600" : "tabular-nums text-neutral-500"}>
                    {u.error ?? `${Math.round(u.progress * 100)}%`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${u.progress * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {loadError && <p className="mt-6 text-sm text-red-600">{loadError}</p>}

        <h2 className="mt-10 text-lg font-semibold">Your library</h2>
        {docs.length === 0 ? (
          <p className="mt-3 text-neutral-500">No documents yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((d) => {
              const pct = d.page_count ? Math.min(100, Math.round(((d.last_page - 1) / d.page_count) * 100)) : 0;
              return (
                <li key={d.id} className="group relative rounded-xl bg-white p-4 shadow-sm transition hover:shadow-md">
                  <Link href={`/read/${d.id}`} className="block">
                    <div className="mb-3 grid h-28 place-items-center rounded-lg bg-gradient-to-br from-violet-100 to-amber-50 text-3xl font-black text-violet-300">
                      PDF
                    </div>
                    <p className="line-clamp-2 font-medium">{d.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {d.page_count ? `${d.page_count} pages · ` : ""}
                      {formatBytes(d.size_bytes)}
                      {d.page_count ? ` · p. ${d.last_page}` : ""}
                    </p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(d)}
                    className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-xs text-neutral-500 opacity-0 shadow transition hover:text-red-600 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function friendlyUploadError(err: Error) {
  const msg = err.message || "";
  if (/413|too large|exceeded the maximum/i.test(msg)) {
    return "File too large for your Supabase upload limit (see docs/API_SETUP.md)";
  }
  return "Upload failed — it will resume if you try again";
}

function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}
function safeRemove(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {}
}
