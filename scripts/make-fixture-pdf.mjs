// Generates e2e/fixtures/big.pdf: a 500-page text PDF with one scanned
// (image-only) page at page 3, to exercise virtualisation, highlighting and OCR.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createRequire } from "node:module";

// Playwright is used from a global install if not in node_modules (npm i -D playwright).
const { chromium } = createRequire(import.meta.url)("playwright");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "e2e/fixtures/big.pdf");
const PAGES = Number(process.env.PAGES ?? 500);

const SENTENCES = [
  "The library was quiet except for the soft hum of the old radiators.",
  "Every book on the top shelf had been read at least a hundred times.",
  "She turned the page and found a note written in faded blue ink.",
  "Nobody remembered who had left it there, or why.",
  "Outside, the rain kept falling on the cobblestones of the square.",
  "It was the kind of evening that made people want to stay indoors and read.",
  "Dr. Ames, the librarian, closed the ledger and switched off the lamp.",
  "Tomorrow, she decided, she would finally find out what the note meant.",
];

async function scannedPagePng() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1224, height: 1584 } });
  await page.setContent(`<body style="margin:0;background:#fbfaf6;font:34px Georgia,serif;color:#222;padding:110px">
    <h1 style="font-size:52px">A Scanned Page</h1>
    <p style="line-height:1.6">This page is only an image, like a photocopy of an old book.
    The words you hear were recognised by optical character recognition.
    The highlight still follows each word as it is spoken.</p></body>`);
  const png = await page.screenshot({ type: "png" });
  await browser.close();
  return png;
}

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
const scan = await pdf.embedPng(await scannedPagePng());

function wrap(text, size, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

for (let p = 1; p <= PAGES; p++) {
  const page = pdf.addPage([612, 792]);
  if (p === 3) {
    page.drawImage(scan, { x: 0, y: 0, width: 612, height: 792 });
    continue;
  }
  page.drawText(`Chapter ${Math.ceil(p / 10)}, page ${p}`, { x: 72, y: 720, size: 18, font: bold });
  let y = 680;
  for (let para = 0; para < 4; para++) {
    const text = Array.from({ length: 4 }, (_, i) => SENTENCES[(p + para * 4 + i) % SENTENCES.length]).join(" ");
    for (const line of wrap(text, 12, 468)) {
      page.drawText(line, { x: 72, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 17;
    }
    y -= 12;
  }
  page.drawText(String(p), { x: 300, y: 40, size: 10, font });
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await pdf.save());
console.log(`wrote ${out} (${PAGES} pages)`);
