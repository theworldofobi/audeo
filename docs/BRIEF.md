# audeo — Product & Technical Brief

> Listen to any PDF, no matter how big, at up to 3× speed — while watching it
> being read in the original document, sentence by sentence and word by word.

---

## 1. Goals

| # | Goal | Success looks like |
|---|------|--------------------|
| G1 | **Upload giant PDFs** | A 1,000-page / 300 MB PDF uploads with a progress bar, survives a dropped connection (resumable) and opens in the reader in < 3 s. |
| G2 | **Read aloud up to 3×** | Speed slider 0.5×–3.0× in 0.1 steps; changing speed is instant (no re-download, no gap) and the voice keeps its natural pitch. |
| G3 | **Dual highlighting** | The sentence being read is highlighted (light yellow); the word being spoken is highlighted a shade darker (amber) on top of it. Highlight stays in sync at every speed. |
| G4 | **Original document preserved** | The PDF is rendered exactly as authored (fonts, images, columns, tables). Highlights are an overlay — the document is never reflowed or converted to plain text. |
| G5 | **Pick up where you left off** | Position, voice and speed are saved per document and synced across devices. |
| G6 | **Scanned PDFs work** | Pages without a text layer are OCR'd in the browser and still get sentence + word highlighting. |

### Non-goals (v1)
- EPUB / DOCX / web articles (architecture allows adding later).
- Offline mode / native mobile apps.
- Voice cloning, translation, summarisation.

---

## 2. Users & stories

- **Student** — "I upload a 600-page textbook, jump to chapter 7, and listen at 2.5× while following the highlighted words."
- **Professional** — "I listen to a 90-page contract on my laptop, pause, and resume on my phone at the same sentence."
- **Researcher** — "I upload a scanned journal article from 1987 and it still reads aloud with highlights."
- **Dyslexic reader** — "The word highlight helps me track where I am on the page."

---

## 3. Feature list

### MVP (this build)
- Email magic-link sign-in (+ optional Google sign-in).
- Library: grid of your documents with title, page count, % progress, delete.
- Upload: drag-and-drop or picker; resumable chunked upload (TUS) with progress; any size up to your Supabase file-size limit.
- Reader:
  - Original PDF rendering (PDF.js canvas + text layer), virtualised pages, zoom (fit-width / +/-).
  - Play / pause, previous / next sentence, ±10 s skip.
  - Speed 0.5×–3.0× with presets (1×, 1.5×, 2×, 2.5×, 3×).
  - Voice picker (Azure neural voices).
  - Sentence highlight + darker word highlight, auto-scroll that follows the voice and pauses when you scroll manually ("Back to voice" button).
  - Click any sentence to start reading from there.
  - Page jump + thumbnail-free page counter.
  - Progress, voice and speed autosaved.
- OCR fallback for scanned pages (Tesseract.js, in browser, cached per page).
- Server-side audio cache so re-listening never pays twice.
- "Open a PDF from this device" mode (`/read/local`): no account, nothing uploaded.
- Mock voice mode in development when no Azure key is set.

### Later
- Skip headers/footers/page numbers/citations heuristics toggle (v1 reads running
  headers and page numbers aloud).
- Bookmarks & notes, export highlights.
- Download as MP3.
- Multi-language voices + auto language detection.
- Sharing / public links.
- PWA + background playback with Media Session API lock-screen controls (partially in MVP).

---

## 4. UX

```
┌──────────────────────────────────────────────────────────────┐
│ audeo   ◀ Library        Contract.pdf        p. 12 / 340  ⚙ │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│            ┌──────────────────────────────┐                  │
│            │  original PDF page, exactly  │                  │
│            │  as authored…                │                  │
│            │  ▓▓▓▓▓▓ sentence ▓██word██▓▓ │  ← overlay       │
│            │                              │                  │
│            └──────────────────────────────┘                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ⏮  ⟲10   ▶   10⟳  ⏭      ───●────── 2.5×      Voice: Jenny ▾│
└──────────────────────────────────────────────────────────────┘
```

**Keyboard shortcuts**

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Previous / next sentence |
| Shift + ← / → | −10 s / +10 s |
| ↑ / ↓ | Speed +0.1× / −0.1× |
| + / − | Zoom in / out |

**Colours** — sentence `rgba(255, 230, 120, .45)`, word `rgba(245, 158, 11, .65)`, both `mix-blend-mode: multiply` so the text underneath stays crisp and readable.

---

## 5. Architecture

```
 Browser (Next.js client)                          Server (Next.js route handlers)        External
 ──────────────────────────                        ────────────────────────────────        ────────
 Library ── tus upload ─────────────────────────────────────────────────────────────────▶ Supabase Storage (pdfs/)
 Reader
  ├─ PDF.js (range requests on signed URL) ◀────────────────────────────────────────────── Supabase Storage
  ├─ TextModel (per page text + char→span map)
  ├─ OCR worker (Tesseract.js) ── cache ──────────────────────────────────────────────────▶ Supabase DB (ocr_pages)
  ├─ Chunker (sentence-aligned ~800 chars)
  ├─ Player ── POST /api/tts {text, voice} ───▶ /api/tts ── cache hit? ── Supabase (audio_cache + audio/)
  │            ◀── {audioUrl, words[]} ─────────          └─ miss → Azure Speech (SSML → MP3 + WordBoundary)
  ├─ <audio> playbackRate 0.5–3, preservesPitch
  ├─ rAF sync loop → HighlightLayer (overlay divs)
  └─ progress autosave ───────────────────────────────────────────────────────────────────▶ Supabase DB (documents)
```

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS, `pdfjs-dist`,
`microsoft-cognitiveservices-speech-sdk` (server only), `@supabase/ssr`,
`tesseract.js`, `tus-js-client`, `zustand`. Tests: Vitest + Playwright.
Hosting: Vercel (or any Node host).

### Why these choices
- **Azure Speech** — natural neural voices and precise `WordBoundary` events
  (audio offset + text offset for every word), at ~$16 per 1M characters.
- **Synthesise at 1×, play back faster** — `audio.playbackRate` with
  `preservesPitch` gives instant speed changes up to 3× without re-synthesis,
  and word timings stay valid because they are in media time.
- **Supabase** — auth, Postgres with row-level security, and S3-compatible
  storage with resumable uploads, all behind one key pair.
- **PDF.js** — renders the original document faithfully and exposes a text
  layer we can map highlights onto.

---

## 6. How highlighting works

1. **Text model.** For each page, PDF.js `getTextContent()` returns text items
   (runs of glyphs with positions). We concatenate them into one page string,
   inserting spaces/newlines where the layout implies them and joining
   hyphenated line breaks, and record for every character which item + offset
   it came from.
2. **Segmentation.** `Intl.Segmenter` splits the document text into sentences
   and words. Sentences are grouped into ~800-character chunks for synthesis.
3. **Synthesis.** Each chunk is wrapped in SSML (XML-escaped, with an offset
   map so escaped characters like `&amp;` don't shift positions) and sent to
   Azure. Every `WordBoundary` event gives `{audioOffset, textOffset, length}`;
   we convert those to `{start seconds, end seconds, charStart, charEnd}` in
   document coordinates.
4. **Playback sync.** A `requestAnimationFrame` loop reads
   `audio.currentTime`, binary-searches the current word, and finds its
   sentence. Only when either changes do we recompute highlight rectangles.
5. **Painting.** Char ranges → DOM `Range` across the text-layer `<span>`s →
   `getClientRects()` → absolutely positioned divs in the page's overlay layer.
   For OCR'd pages, rectangles come straight from Tesseract word boxes.

Result: highlighting sits on the exact glyphs of the original PDF, at any
speed, any zoom.

---

## 7. Giant-PDF performance plan

| Problem | Solution |
|---------|----------|
| Upload of hundreds of MB | TUS resumable upload in 6 MB chunks direct to Supabase Storage. |
| Downloading whole file before reading | PDF.js with HTTP range requests (`disableAutoFetch`) on a signed URL — only the bytes for visible pages are fetched. |
| 1,000 canvases in the DOM | Virtualised list: placeholders sized from page viewports, only visible pages ±2 get canvas + text layer; off-screen canvases are released. |
| Extracting all text up front | Text extracted lazily per page; the chunker only looks ahead a few pages from the reading position. |
| Synthesising a whole book | Synthesis is on demand: current chunk + 2 prefetched. Cached server-side by hash(voice + text). |
| OCR of scanned books | OCR runs in a Web Worker, only for pages near the reading position, results cached in Postgres forever. |

---

## 8. Data model (Supabase / Postgres)

```sql
documents (
  id uuid pk, user_id uuid → auth.users,
  title text, storage_path text, size_bytes bigint, page_count int,
  last_offset int,          -- global char offset of last spoken word
  last_page int,
  voice text, rate real,
  created_at, updated_at
)
ocr_pages (
  document_id uuid → documents, page int, text text, words jsonb,
  pk (document_id, page)
)
audio_cache (
  hash text pk,             -- sha256(voice | text)
  voice text, storage_path text, words jsonb, chars int, created_at
)
```

Storage buckets (private): `pdfs/{user_id}/{document_id}.pdf`,
`audio/{hash}.mp3`. Row-level security restricts `documents` and `ocr_pages`
to their owner; `audio_cache` is only touched by the server with the service
role key.

---

## 9. Cost notes

- Azure neural TTS ≈ **$16 / 1M characters** (S0, pay-as-you-go). A typical
  300-page book ≈ 600k characters ≈ **$10** to listen to once. Speed changes
  are free (no re-synthesis); re-listening is free (cached).
- Azure F0 (free) tier: 0.5M characters / month — fine for development.
- Supabase Free: 1 GB storage, 50 MB max file size. Pro ($25/mo): 100 GB
  included, file-size limit configurable up to 500 GB.

---

## 10. Security

- Azure key lives only on the server (`/api/tts`). The browser never sees it.
- `/api/tts` requires a signed-in user and caps text length per request
  (5,000 chars) to prevent abuse.
- Supabase RLS on all user tables; storage paths namespaced by user id.
- Signed URLs for PDFs expire after 1 hour.

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| PDF text order is wrong in multi-column layouts | PDF.js order is usually reading order; later: column-aware sort heuristic. |
| Ligatures / hyphenation shift offsets | Text model normalises and keeps a per-char map, so offsets always map back to real spans. |
| Very high speeds sound choppy in some browsers | `preservesPitch` supported in all evergreen browsers; 3× is within Chrome/Safari/Firefox limits. |
| Azure costs on huge documents | Server cache, on-demand synthesis, per-request size cap. |
| OCR is slow on large scanned books | Only OCR pages near the reader, in a worker, cached permanently. |

---

## 12. Milestones

1. **M0 — Brief & setup guide** (this document, `docs/API_SETUP.md`, `.env.example`).
2. **M1 — Scaffold** Next.js, Tailwind, Supabase auth, schema migration.
3. **M2 — Library & upload** resumable upload, document list.
4. **M3 — Reader** virtualised PDF.js rendering, text model.
5. **M4 — Voice** Azure TTS route, cache, player, 0.5–3× speed.
6. **M5 — Highlighting** sentence + word overlay, auto-scroll, click-to-read.
7. **M6 — OCR** Tesseract fallback for scanned pages.
8. **M7 — Polish** shortcuts, progress sync, tests, deploy.
