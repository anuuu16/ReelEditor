import { describe, expect, it } from "vitest";
import { createTextLayer } from "./document.js";
import { layoutText, textFont } from "./textLayout.js";
import { FAKE_CHAR_WIDTH_EM } from "../test/setup.js";

// The test canvas measures every character as 0.6em (see test/setup.ts), so widths are exact.
const W = 1000;

describe("layoutText", () => {
  it("builds the canvas font string from the layer's type settings", () => {
    const layer = createTextLayer({ fontSize: 0.05, bold: true, italic: true, fontFamily: "serif" });
    expect(textFont(layer, W)).toBe('italic 700 50px Georgia, "Times New Roman", serif');
  });

  it("keeps short text on one line and sizes the box from the type", () => {
    const layer = createTextLayer({ text: "Hi", fontSize: 0.05, lineHeight: 1.2, padding: 0.01, width: 0.5 });
    const layout = layoutText(layer, W);
    expect(layout.lines).toEqual(["Hi"]);
    expect(layout.fontPx).toBe(50);
    expect(layout.width).toBe(500);
    expect(layout.height).toBe(50 * 1.2 + 2 * 10);
  });

  it("wraps words that don't fit inside the padded width", () => {
    // 50px type × 0.6 = 30px per character; inner width 300 - 20 = 280px → 9 characters per line.
    const layer = createTextLayer({ text: "aaaa bbbb cccc dddd", fontSize: 0.05, padding: 0.01, width: 0.3 });
    const layout = layoutText(layer, W);
    expect(layout.lines).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(layout.height).toBe(2 * 50 * 1.2 + 20);
  });

  it("honours explicit line breaks and never loses an over-long word", () => {
    const layer = createTextLayer({ text: "one\ntwo", fontSize: 0.05, padding: 0, width: 0.3 });
    expect(layoutText(layer, W).lines).toEqual(["one", "two"]);
    const long = createTextLayer({ text: "supercalifragilistic", fontSize: 0.05, padding: 0, width: 0.1 });
    expect(layoutText(long, W).lines).toEqual(["supercalifragilistic"]);
  });

  it("empty text still occupies one line so the box stays selectable", () => {
    const layout = layoutText(createTextLayer({ text: "", fontSize: 0.05 }), W);
    expect(layout.lines).toEqual([""]);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("measures with the fake at the expected character width (guards the fixture itself)", () => {
    expect(FAKE_CHAR_WIDTH_EM).toBe(0.6);
  });
});
