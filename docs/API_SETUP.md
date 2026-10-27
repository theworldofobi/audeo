# APIs & services you must hook up manually

audeo needs **two** accounts to run: **Azure AI Speech** (voices) and
**Supabase** (sign-in, database, file storage). Google sign-in and Vercel are
optional. Nothing else needs a key — OCR (Tesseract.js) and PDF rendering
(PDF.js) run in the browser.

Copy `.env.example` to `.env.local` and fill it in as you go:

```bash
cp .env.example .env.local
```

| Variable | Where it comes from | Exposed to browser? |
|----------|--------------------|---------------------|
| `AZURE_SPEECH_KEY` | Azure portal → Speech resource → Keys and Endpoint → KEY 1 | **No** |
| `AZURE_SPEECH_REGION` | Same page → Location/Region (e.g. `eastus`) | **No** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key | **No — never commit** |
| `NEXT_PUBLIC_SITE_URL` | Your app URL (`http://localhost:3000` locally) | Yes |

---

## 1. Azure AI Speech (text-to-speech + word timings)

1. Sign in at <https://portal.azure.com> (create a free account if needed).
2. **Create a resource** → search **"Speech"** → choose **Speech** (Azure AI services) → **Create**.
3. Fill in:
   - Subscription / Resource group: any (create `audeo-rg`).
   - Region: one close to your users, e.g. **East US** (`eastus`) or **West Europe** (`westeurope`).
     All neural voices used by audeo are available in these regions.
   - Name: `audeo-speech`.
   - Pricing tier: **Free F0** for development (0.5M chars/month) or
     **Standard S0** for real use (~$16 per 1M characters).
4. **Review + create** → **Create** → **Go to resource**.
5. Open **Keys and Endpoint**. Copy **KEY 1** → `AZURE_SPEECH_KEY`, and
   **Location/Region** → `AZURE_SPEECH_REGION`.

Test it (optional):

```bash
curl -s -X POST "https://$AZURE_SPEECH_REGION.tts.speech.microsoft.com/cognitiveservices/v1" \
  -H "Ocp-Apim-Subscription-Key: $AZURE_SPEECH_KEY" \
  -H "Content-Type: application/ssml+xml" \
  -H "X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3" \
  -d '<speak version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural">Hello from audeo</voice></speak>' \
  -o hello.mp3 && ls -l hello.mp3
```

> Until you set `AZURE_SPEECH_KEY`, the app runs in **mock voice mode** in
> development: silent audio with simulated word timings, so you can test the
> reader and highlighting without a key.

---

## 2. Supabase (auth, database, storage)

1. Create a project at <https://supabase.com/dashboard> → **New project**.
   Pick a strong DB password and a region near your Azure region.
2. **Project Settings → API**: copy **Project URL**, **anon public** key and
   **service_role** key into `.env.local`.
3. **SQL Editor → New query**: paste the whole of
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) and **Run**.
   This creates the `documents`, `ocr_pages` and `audio_cache` tables,
   row-level-security policies, and the private storage buckets `pdfs` and
   `audio` with their access policies.
4. **Storage**: confirm the `pdfs` and `audio` buckets exist and are **private**.
5. **Big files — raise the upload limit.**
   - Free plan: hard cap **50 MB per file**.
   - Pro plan: **Project Settings → Storage → Upload file size limit** — set
     it (e.g. `1 GB`). Then also raise the per-bucket limit: **Storage →
     pdfs → Edit bucket → File size limit** (the migration sets 1 GB).
6. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (change to production URL later).
   - Redirect URLs: add `http://localhost:3000/auth/callback` and
     `https://YOUR-DOMAIN/auth/callback`.
7. **Authentication → Providers → Email**: enabled (default). Magic links
   work out of the box; for production set up custom SMTP
   (**Project Settings → Auth → SMTP**) because Supabase's built-in mailer is
   rate-limited to a few emails per hour.

---

## 3. (Optional) Google sign-in

1. <https://console.cloud.google.com> → create project → **APIs & Services →
   OAuth consent screen** → External → fill app name "audeo", support email.
2. **Credentials → Create credentials → OAuth client ID** → Web application.
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (shown on the Supabase Google provider page).
3. Copy Client ID + Secret into **Supabase → Authentication → Providers →
   Google** and enable it. No env vars needed in audeo.

---

## 4. (Optional) Deploy to Vercel

1. <https://vercel.com/new> → import `theworldofobi/audeo`.
2. Add all variables from `.env.local` under **Settings → Environment
   Variables** (set `NEXT_PUBLIC_SITE_URL` to your Vercel URL).
3. Deploy, then add `https://<your-app>.vercel.app/auth/callback` to the
   Supabase redirect URLs (step 2.6).

---

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
```

## Checklist

- [ ] Azure Speech resource created, key + region in `.env.local`
- [ ] Supabase project created, URL + anon + service_role keys in `.env.local`
- [ ] `0001_init.sql` run in SQL editor
- [ ] Upload size limit raised (Pro plan) for giant PDFs
- [ ] Redirect URLs added in Supabase Auth
- [ ] (optional) Google provider enabled
- [ ] (optional) Vercel env vars set
