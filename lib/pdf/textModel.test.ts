import { describe, expect, it } from "vitest";
import { buildOcrPageText, buildPdfPageText, sliceByItem, type RawTextItem } from "./textModel";

const item = (str: string, x: number, y: number, width: number, hasEOL = false): RawTextItem => ({
  str,
  hasEOL,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
});

describe("buildPdfPageText", () => {
  it("joins items on a line and adds spaces at line breaks", () => {
    const pt = buildPdfPageText(1, [item("Hello", 0, 100, 25), item("world.", 30, 100, 30, true), item("Next", 0, 85, 20)]);
    expect(pt.text).toBe("Hello world. Next");
    // "w" maps to item 1 offset 0
    const w = pt.text.indexOf("w");
    expect(pt.itemIdx[w]).toBe(1);
    expect(pt.itemOff[w]).toBe(0);
    // synthetic separator
    expect(pt.itemIdx[5]).toBe(-1);
  });

  it("does not add a space between touching items", () => {
    const pt = buildPdfPageText(1, [item("Hel", 0, 100, 15), item("lo", 15, 100, 10)]);
    expect(pt.text).toBe("Hello");
  });

  it("joins words hyphenated across lines", () => {
    const pt = buildPdfPageText(1, [item("an exam-", 0, 100, 40, true), item("ple of it", 0, 85, 45)]);
    expect(pt.text).toBe("an example of it");
    const p = pt.text.indexOf("ple");
    expect(pt.itemIdx[p]).toBe(1);
  });

  it("keeps real hyphens before capitals", () => {
    const pt = buildPdfPageText(1, [item("Anglo-", 0, 100, 30, true), item("Saxon", 0, 85, 25)]);
    expect(pt.text).toBe("Anglo- Saxon");
  });
});

describe("block breaks", () => {
  it("ends a sentence at a heading or paragraph gap, not at a plain line break", () => {
    const heading: RawTextItem = { str: "Chapter One", hasEOL: true, transform: [18, 0, 0, 18, 0, 720], width: 90, height: 18 };
    const pt = buildPdfPageText(1, [
      heading,
      item("It was dark and", 0, 680, 80, true),
      item("cold.", 0, 663, 25, true),
      item("Next paragraph", 0, 634, 70),
    ]);
    expect(pt.text).toBe("Chapter One\nIt was dark and cold.\nNext paragraph");
  });
});

describe("sliceByItem", () => {
  it("splits a page range into per-item slices", () => {
    const pt = buildPdfPageText(1, [item("Hello", 0, 100, 25), item("world.", 30, 100, 30)]);
    expect(sliceByItem(pt, 3, 9)).toEqual([
      { item: 0, start: 3, end: 5 },
      { item: 1, start: 0, end: 3 },
    ]);
  });
});

describe("buildOcrPageText", () => {
  it("maps chars to OCR words", () => {
    const pt = buildOcrPageText(
      2,
      [
        { text: "Old", x0: 0, y0: 0, x1: 0.1, y1: 0.05 },
        { text: "scan", x0: 0.12, y0: 0, x1: 0.2, y1: 0.05 },
        { text: "here", x0: 0, y0: 0.06, x1: 0.1, y1: 0.1 },
      ],
      new Set([2]),
    );
    expect(pt.text).toBe("Old scan\nhere");
    expect(sliceByItem(pt, 4, 13)).toEqual([
      { item: 1, start: 0, end: 4 },
      { item: 2, start: 0, end: 4 },
    ]);
  });
});
