// End-to-end check of the reader in mock-voice mode (no Azure/Supabase keys):
//   npm run fixture:pdf && npm run dev   (in another shell)
//   BASE_URL=http://localhost:3000 npm run test:e2e
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Playwright is used from a global install if not in node_modules (npm i -D playwright).
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = join(root, "e2e/out");
mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

const wordText = () =>
  page.evaluate(() => {
    const w = document.querySelector(".hl-word");
    if (!w) return null;
    const pageEl = w.closest("[data-page]");
    const r = w.getBoundingClientRect();
    const spans = [...pageEl.querySelectorAll(".textLayer span")].filter((s) => {
      const b = s.getBoundingClientRect();
      return b.bottom > r.top + 2 && b.top < r.bottom - 2;
    });
    return { page: pageEl.dataset.page, top: Math.round(r.top), left: Math.round(r.left), spans: spans.length };
  });

try {
  await page.goto(`${BASE}/read/local`);
  const t0 = Date.now();
  await page.setInputFiles('[data-testid="local-file"]', join(root, "e2e/fixtures/big.pdf"));
  await page.waitForSelector('[data-page="1"] .textLayer span', { timeout: 30000 });
  const openMs = Date.now() - t0;
  const pageCount = await page.locator("[data-page]").count();
  const canvases = await page.evaluate(
    () => document.querySelectorAll("[data-page] canvas").length,
  );
  check("opens a 500-page PDF", pageCount === 500, `${pageCount} pages in ${openMs} ms`);
  check("only renders pages near the viewport", canvases > 0 && canvases <= 12, `${canvases} live canvases`);

  await page.click('[data-testid="play"]');
  await page.waitForSelector(".hl-word", { timeout: 20000 });
  const sentenceCount = await page.locator(".hl-sentence").count();
  check("highlights the sentence", sentenceCount > 0, `${sentenceCount} sentence boxes`);
  const colors = await page.evaluate(() => ({
    s: getComputedStyle(document.querySelector(".hl-sentence")).backgroundColor,
    w: getComputedStyle(document.querySelector(".hl-word")).backgroundColor,
  }));
  check("word highlight is darker than sentence highlight", colors.s !== colors.w, `${colors.s} vs ${colors.w}`);
  const inside = await page.evaluate(() => {
    const w = document.querySelector(".hl-word").getBoundingClientRect();
    return [...document.querySelectorAll(".hl-sentence")].some((s) => {
      const b = s.getBoundingClientRect();
      return w.left >= b.left - 6 && w.right <= b.right + 6 && w.top >= b.top - 6 && w.bottom <= b.bottom + 6;
    });
  });
  check("word box sits inside the sentence box", inside);
  await page.screenshot({ path: join(outDir, "reading-1x.png") });

  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const w = await wordText();
    if (w) seen.add(`${w.page}:${w.top}:${w.left}`);
    await page.waitForTimeout(150);
  }
  check("word highlight advances at 1×", seen.size >= 4, `${seen.size} distinct positions in 1.5 s`);

  await page.click('[data-testid="speed"]');
  await page.click('[data-testid="speed-3"]');
  const rate = await page.evaluate(() => window.__audeo.audio.playbackRate);
  const pitch = await page.evaluate(() => window.__audeo.audio.preservesPitch);
  check("speed set to 3×", rate === 3, `playbackRate=${rate}, preservesPitch=${pitch}`);
  const seen3 = new Set();
  for (let i = 0; i < 10; i++) {
    const w = await wordText();
    if (w) seen3.add(`${w.page}:${w.top}:${w.left}`);
    await page.waitForTimeout(150);
  }
  check("word highlight advances faster at 3×", seen3.size > seen.size, `${seen3.size} distinct positions in 1.5 s`);
  await page.screenshot({ path: join(outDir, "reading-3x.png") });

  // Speed survives the move to the next chunk.
  await page.waitForFunction(() => window.__audeo.audio.currentTime > 0 && window.__audeo.audio.playbackRate === 3);

  // Click-to-read on page 2.
  await page.keyboard.press(" ");
  const p2 = page.locator('[data-page="2"]');
  await p2.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-page="2"] .textLayer span');
  const target = p2.locator(".textLayer span").nth(8);
  await target.click();
  await page.waitForFunction(() => document.querySelector(".hl-word")?.closest("[data-page]")?.dataset.page === "2", null, {
    timeout: 15000,
  });
  check("click a sentence to start reading there", true);

  // Next sentence moves the sentence highlight.
  const sentenceAt = () =>
    page.evaluate(() => {
      const r = document.querySelector(".hl-sentence")?.getBoundingClientRect();
      return r ? `${Math.round(r.left)},${Math.round(r.top)}` : null;
    });
  const before = await sentenceAt();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const after = await sentenceAt();
  check("→ jumps to the next sentence", after && after !== before, `${before} → ${after}`);

  // OCR: scanned page 3.
  await page.keyboard.press(" ");
  const p3 = page.locator('[data-page="3"]');
  await p3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const box = await p3.boundingBox();
  // click on the first paragraph of the scanned page
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.2);
  await page.waitForFunction(
    () => document.querySelector(".hl-word")?.closest("[data-page]")?.dataset.page === "3",
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(800);
  check("reads and highlights a scanned (OCR) page", true);
  await p3.screenshot({ path: join(outDir, "ocr-page.png") });
} catch (e) {
  check("e2e run", false, e.message);
  await page.screenshot({ path: join(outDir, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
