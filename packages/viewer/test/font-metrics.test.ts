import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureText, parseFontMetrics, wrapText } from "../src/font-metrics.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

describe("parseFontMetrics", () => {
  it("reads unitsPerEm from the vendored Inter", () => {
    expect(METRICS.unitsPerEm).toBeGreaterThan(0);
  });

  it("maps mapped code points to positive advances", () => {
    expect(METRICS.advanceWidth("A".codePointAt(0)!)).toBeGreaterThan(0);
    expect(METRICS.advanceWidth(" ".codePointAt(0)!)).toBeGreaterThan(0);
  });

  it("distinguishes narrow and wide glyphs", () => {
    const i = METRICS.advanceWidth("i".codePointAt(0)!);
    const m = METRICS.advanceWidth("m".codePointAt(0)!);
    expect(m).toBeGreaterThan(i);
  });

  it("falls back to the .notdef advance for unmapped code points", () => {
    expect(METRICS.advanceWidth(0xe0001)).toBe(METRICS.advanceWidth(0xe0002));
  });

  it("rejects non-font input", () => {
    expect(() => parseFontMetrics(new Uint8Array(64))).toThrow();
  });
});

describe("measureText", () => {
  it("scales linearly with font size", () => {
    const at14 = measureText("Click Play", 14, METRICS);
    const at28 = measureText("Click Play", 28, METRICS);
    expect(at28).toBeCloseTo(at14 * 2, 6);
  });

  it("is monotonic in text length", () => {
    expect(measureText("Click Play now", 14, METRICS)).toBeGreaterThan(
      measureText("Click Play", 14, METRICS),
    );
    expect(measureText("", 14, METRICS)).toBe(0);
  });
});

describe("wrapText", () => {
  it("keeps short text on a single line", () => {
    expect(wrapText("Click Play", 14, 280, METRICS)).toEqual(["Click Play"]);
  });

  it("wraps long copy so every line fits the max width", () => {
    const copy = "Click the Play button in the toolbar to open the recap sidebar for this video";
    const lines = wrapText(copy, 14, 120, METRICS);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(measureText(line, 14, METRICS)).toBeLessThanOrEqual(120);
    }
  });

  it("preserves every word in order (whitespace collapsed)", () => {
    const copy = "one  two\tthree\nfour five";
    expect(wrapText(copy, 14, 60, METRICS).join(" ")).toBe("one two three four five");
  });

  it("hard-breaks a word wider than the line (overflow-wrap: anywhere analog)", () => {
    const lines = wrapText("supercalifragilisticexpialidocious", 14, 60, METRICS);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, 14, METRICS)).toBeLessThanOrEqual(60);
    }
    expect(lines.join("")).toBe("supercalifragilisticexpialidocious");
  });

  it("returns a single empty line for empty input", () => {
    expect(wrapText("", 14, 280, METRICS)).toEqual([""]);
    expect(wrapText("   ", 14, 280, METRICS)).toEqual([""]);
  });
});
