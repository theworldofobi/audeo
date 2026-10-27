import { describe, expect, it } from "vitest";
import { alignWords } from "./align";
import { buildChunk, chunkOffsetToPosition, chunkRangeToPages } from "./chunker";
import { buildSsml } from "./ssml";
import { lastAtOrBefore, sentences, splitLong } from "@/lib/pdf/segment";
import type { PageText } from "@/lib/pdf/textModel";

const page = (n: number, text: string): PageText => ({
  page: n,
  text,
  kind: "pdf",
  itemIdx: new Int32Array(text.length),
  itemOff: Int32Array.from(text, (_, i) => i),
});

describe("buildSsml", () => {
  it("escapes XML and maps SSML offsets back to text offsets", () => {
    const text = `Tom & Jerry say "hi" <loud>.`;
    const { ssml, toTextOffset } = buildSsml(text, "en-US-JennyNeural");
    expect(ssml).toContain("Tom &amp; Jerry say &quot;hi&quot; &lt;loud&gt;.");
    for (const word of ["Tom", "Jerry", "say", "hi", "loud"]) {
      const ssmlOffset = ssml.indexOf(word, ssml.indexOf("<voice"));
      expect(text.slice(toTextOffset(ssmlOffset), toTextOffset(ssmlOffset) + word.length)).toBe(word);
    }
    expect(toTextOffset(0)).toBe(-1);
  });

  it("uses the voice locale", () => {
    expect(buildSsml("x", "en-GB-SoniaNeural").ssml).toContain('xml:lang="en-GB"');
  });
});

describe("alignWords", () => {
  it("uses offsets when they match and recovers when they drift", () => {
    const text = "Hello brave new world";
    const words = alignWords(text, [
      { offset: 0, text: "Hello", audioOffset: 0, duration: 4_000_000 },
      { offset: 3, text: "brave", audioOffset: 5_000_000, duration: 4_000_000 }, // wrong offset
      { offset: 12, text: "new", audioOffset: 10_000_000, duration: 2_000_000 },
      { offset: -1, text: "world", audioOffset: 13_000_000, duration: 4_000_000 },
    ]);
    expect(words.map((w) => text.slice(w.s, w.e))).toEqual(["Hello", "brave", "new", "world"]);
    expect(words[1].t).toBeCloseTo(0.5);
  });
});

describe("segmentation", () => {
  it("splits sentences, keeping abbreviations together", () => {
    const text = "Dr. Smith arrived. He sat down!  Then?";
    const r = sentences(text).map(([s, e]) => text.slice(s, e));
    expect(r).toEqual(["Dr. Smith arrived.", "He sat down!", "Then?"]);
  });

  it("splits very long sentences at word boundaries", () => {
    const text = "word ".repeat(100).trim();
    const parts = splitLong(text, [0, text.length], 50);
    expect(parts.every(([s, e]) => e - s <= 50)).toBe(true);
    expect(parts.map(([s, e]) => text.slice(s, e)).join(" ")).toBe(text);
  });

  it("binary searches", () => {
    const arr = [0, 1, 2.5, 4];
    expect(lastAtOrBefore(arr, 3, (x) => x)).toBe(2);
    expect(lastAtOrBefore(arr, -1, (x) => x)).toBe(-1);
  });
});

describe("buildChunk", () => {
  const pages = [
    page(1, "First sentence. Second sentence. This one continues on the"),
    page(2, "next page. Then more."),
    page(3, "   "),
    page(4, "Last page."),
  ];
  const get = async (n: number) => pages[n - 1];

  it("takes sentences up to the char budget", async () => {
    const c = await buildChunk({ page: 1, offset: 0 }, 4, get, 20);
    expect(c!.text).toBe("First sentence.");
    expect(c!.next).toEqual({ page: 1, offset: 16 });
  });

  it("pulls a sentence that runs over a page break", async () => {
    const c = await buildChunk({ page: 1, offset: 0 }, 4, get, 800);
    expect(c!.text).toBe("First sentence. Second sentence. This one continues on the next page.");
    expect(c!.pieces).toHaveLength(2);
    expect(c!.sentences).toHaveLength(3);
    expect(c!.next).toEqual({ page: 2, offset: 10 });
    const at = c!.text.indexOf("next");
    expect(chunkOffsetToPosition(c!, at)).toEqual({ page: 2, offset: 0 });
    expect(chunkRangeToPages(c!, c!.sentences[2][0], c!.sentences[2][1])).toEqual([
      { page: 1, start: 33, end: 58 },
      { page: 2, start: 0, end: 10 },
    ]);
  });

  it("skips blank pages and ends at the last page", async () => {
    const c = await buildChunk({ page: 2, offset: 10 }, 4, get, 800);
    expect(c!.text).toBe("Then more.");
    expect(c!.next).toEqual({ page: 3, offset: 0 });
    const d = await buildChunk(c!.next!, 4, get, 800);
    expect(d!.text).toBe("Last page.");
    expect(d!.start).toEqual({ page: 4, offset: 0 });
    expect(d!.next).toBeNull();
  });
});
