# audeo

Listen to any PDF, even giant ones, at up to **3× speed**. You follow along on the
**original document**: the current sentence is highlighted, and the word being
spoken is highlighted a shade darker.

- 📄 **Product brief:** [`docs/BRIEF.md`](docs/BRIEF.md)
- 🔑 **APIs you must hook up:** [`docs/API_SETUP.md`](docs/API_SETUP.md) (Azure AI Speech + Supabase)

## Features

- Resumable uploads of very large PDFs to your private Supabase library
- PDF.js rendering of the untouched original, with virtualised pages and HTTP range requests (only the pages you view are downloaded)
- Azure neural voices with per-word timings; speed 0.5×–3× without re-synthesis (pitch preserved)
- Sentence highlight plus a darker word highlight, auto-scroll that follows the voice, and click any sentence to start there
- Scanned PDFs: in-browser OCR (Tesseract.js), cached per page
- Progress, voice and speed are saved per document; synthesized audio is cached server-side
- Keyboard: `Space` play/pause · `←/→` sentence · `Shift+←/→` ±10 s · `↑/↓` speed · `+/−` zoom
- **Open a PDF from this device** (`/read/local`) works with no account

## Run it

```bash
npm install                 # also copies pdf.js + tesseract assets into public/
cp .env.example .env.local  # fill in keys, see docs/API_SETUP.md
npm run dev                 # http://localhost:3000
```

Without `AZURE_SPEECH_KEY`, development runs in **mock voice mode**: silent
audio with simulated word timings, so you can try the reader and highlighting
before you have keys.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | Unit tests (text model, segmentation, SSML offsets, chunking, word alignment) |
| `npm run fixture:pdf` | Generates `e2e/fixtures/big.pdf` (500 pages, one scanned page). Needs Playwright. |
| `npm run test:e2e` | Browser test against a running dev server (`BASE_URL`, default `http://localhost:3000`). Needs Playwright. |

## Layout

```
app/                 routes: /, /login, /library, /read/[id], /read/local, /api/tts, /auth/*
components/reader/   Reader, PageView (canvas + highlight overlay + text layer), PlayerBar
components/library/  upload + document grid
lib/pdf/             pdf.js loader, text model (char → glyph map), segmentation, OCR
lib/tts/             chunker, narrator (audio + sync loop), SSML, Azure, mock
supabase/migrations/ schema, RLS policies, storage buckets
```
