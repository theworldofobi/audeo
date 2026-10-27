// Copies runtime assets for PDF.js and Tesseract.js into public/ so they are
// self-hosted (no CDN, no extra API to configure).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

function copy(from, to) {
  if (!existsSync(from)) {
    console.warn(`[copy-assets] missing ${from}`);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

const pdfjs = pkgDir("pdfjs-dist");
const pub = join(root, "public");
copy(join(pdfjs, "build/pdf.worker.min.mjs"), join(pub, "pdfjs/pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  copy(join(pdfjs, dir), join(pub, "pdfjs", dir));
}

const tess = pkgDir("tesseract.js");
const core = pkgDir("tesseract.js-core");
copy(join(tess, "dist/worker.min.js"), join(pub, "tesseract/worker.min.js"));
for (const f of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) {
  copy(join(core, f), join(pub, "tesseract/core", f));
}
copy(
  join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"),
  join(pub, "tesseract/lang/eng.traineddata.gz"),
);

console.log("[copy-assets] pdf.js + tesseract assets copied to public/");
