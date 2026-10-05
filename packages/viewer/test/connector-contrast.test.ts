import { describe, expect, it } from "vitest";
import {
  DARK_LUMA,
  lumaAt,
  lumaOf,
  needsConnectorHalo,
  sampleDark,
  type PixelGrid,
} from "../src/connector-contrast.js";
import { decodeScreenshot } from "../src/screenshot-pixels.js";
import { arrowGeometry, arrowHaloGeometry } from "../src/arrow.js";
import { encodePng, layeredPng } from "./helpers/png.js";

/** 100x20 grid, `grey` everywhere except columns x >= `from`, which get `other`. */
function split(grey: number, other: number, from: number): PixelGrid {
  const width = 100;
  const height = 20;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x >= from ? other : grey;
      rgba.set([v, v, v], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}
const PATH = { x: 0, y: 4, width: 100, height: 12 };

describe("lumaOf", () => {
  it("is integer Rec. 601 luma: black 0, white 255, green brighter than blue", () => {
    expect(lumaOf(0, 0, 0)).toBe(0);
    expect(lumaOf(255, 255, 255)).toBe(255);
    expect(lumaOf(0, 255, 0)).toBe(149);
    expect(lumaOf(0, 0, 255)).toBe(28);
    expect(Number.isInteger(lumaOf(13, 77, 201))).toBe(true);
  });

  it("reads one pixel of a grid and nothing outside it", () => {
    const grid = split(10, 240, 50);
    expect(lumaAt(grid, 0, 0)).toBe(10);
    expect(lumaAt(grid, 99, 19)).toBe(240);
    expect(lumaAt(grid, -1, 0)).toBeUndefined();
    expect(lumaAt(grid, 100, 0)).toBeUndefined();
    expect(lumaAt(grid, 0, 20)).toBeUndefined();
  });
});

describe("sampleDark", () => {
  it("counts dark pixels under the boxes, clipped to the grid", () => {
    const grid = split(20, 240, 75);
    expect(sampleDark(grid, [PATH])).toEqual({ dark: 75 * 12, total: 100 * 12 });
    // Half the box hangs off the left edge: only the part inside the grid counts.
    expect(sampleDark(grid, [{ x: -50, y: 0, width: 100, height: 10 }])).toEqual({
      dark: 500,
      total: 500,
    });
    expect(sampleDark(grid, [{ x: 500, y: 500, width: 5, height: 5 }])).toEqual({
      dark: 0,
      total: 0,
    });
  });

  it("treats fractional box edges as the whole pixels they touch", () => {
    const grid = split(20, 20, 0);
    expect(sampleDark(grid, [{ x: 1.4, y: 1.4, width: 2, height: 2 }]).total).toBe(9);
  });
});

describe("needsConnectorHalo", () => {
  it("is true on a dark background", () => {
    expect(needsConnectorHalo(split(18, 18, 0), [PATH])).toBe(true);
  });

  it("is false on a light background, white included", () => {
    expect(needsConnectorHalo(split(255, 255, 0), [PATH])).toBe(false);
    expect(needsConnectorHalo(split(240, 240, 0), [PATH])).toBe(false);
  });

  it("decides on the share of dark pixels along a mixed path: one third or more is dark", () => {
    // dark from the left, light from column `from`: share of dark = from / 100
    expect(needsConnectorHalo(split(20, 245, 50), [PATH])).toBe(true);
    expect(needsConnectorHalo(split(20, 245, 34), [PATH])).toBe(true);
    expect(needsConnectorHalo(split(20, 245, 33), [PATH])).toBe(false);
    expect(needsConnectorHalo(split(20, 245, 10), [PATH])).toBe(false);
  });

  it("puts the dark/light line at luma 110", () => {
    expect(needsConnectorHalo(split(DARK_LUMA - 1, DARK_LUMA - 1, 0), [PATH])).toBe(true);
    expect(needsConnectorHalo(split(DARK_LUMA, DARK_LUMA, 0), [PATH])).toBe(false);
  });

  it("pools several boxes (stem and arrow) into one decision", () => {
    const grid = split(20, 245, 50);
    const dark = { x: 0, y: 0, width: 50, height: 10 };
    const light = { x: 50, y: 0, width: 50, height: 10 };
    expect(needsConnectorHalo(grid, [dark, light])).toBe(true);
    expect(needsConnectorHalo(grid, [light])).toBe(false);
  });

  it("is false when the boxes sample no pixels", () => {
    expect(needsConnectorHalo(split(0, 0, 0), [])).toBe(false);
    expect(needsConnectorHalo(split(0, 0, 0), [{ x: 900, y: 900, width: 4, height: 4 }])).toBe(
      false,
    );
  });
});

describe("decodeScreenshot", () => {
  it("returns the PNG's pixels 1:1, identically on every call", () => {
    const rgba = new Uint8Array(5 * 3 * 4);
    for (let i = 0; i < 15; i++) rgba.set([i * 17, 255 - i * 11, (i * 53) % 256, 255], i * 4);
    const png = encodePng(rgba, 5, 3);
    const a = decodeScreenshot(png, 5, 3);
    expect(a).toMatchObject({ width: 5, height: 3 });
    expect(Array.from(a.rgba)).toEqual(Array.from(rgba));
    expect(Array.from(decodeScreenshot(png, 5, 3).rgba)).toEqual(Array.from(a.rgba));
  });

  it("reads a transparent pixel as white and a half-transparent black one as mid grey", () => {
    const rgba = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 128]);
    const grid = decodeScreenshot(encodePng(rgba, 2, 1), 2, 1);
    expect(Array.from(grid.rgba.slice(0, 4))).toEqual([255, 255, 255, 255]);
    const [r, g, b, a] = Array.from(grid.rgba.slice(4, 8));
    expect(a).toBe(255);
    expect(r).toBeGreaterThanOrEqual(120);
    expect(r).toBeLessThanOrEqual(135);
    expect([g, b]).toEqual([r, r]);
  });

  it("feeds the decision: a dark screenshot needs the halo, a light one does not", () => {
    const dark = decodeScreenshot(layeredPng(100, 20, 18), 100, 20);
    const light = decodeScreenshot(layeredPng(100, 20, 250), 100, 20);
    expect(needsConnectorHalo(dark, [PATH])).toBe(true);
    expect(needsConnectorHalo(light, [PATH])).toBe(false);
  });
});

describe("arrowHaloGeometry", () => {
  const tip = { x: 100, y: 50 };
  for (const side of ["top", "bottom", "left", "right"] as const) {
    it(`${side}: a box around the ink arrow, 2 px out on the edges, the tip a little further`, () => {
      const ink = arrowGeometry(side, tip);
      const halo = arrowHaloGeometry(side, tip, 2);
      expect(halo.left).toBeLessThanOrEqual(ink.left - 2);
      expect(halo.top).toBeLessThanOrEqual(ink.top - 2);
      expect(halo.left + halo.width).toBeGreaterThanOrEqual(ink.left + ink.width + 2);
      expect(halo.top + halo.height).toBeGreaterThanOrEqual(ink.top + ink.height + 2);
      expect(halo.clipPath).toMatch(/^polygon\((-?[\d.]+px -?[\d.]+px(, )?){3}\)$/);
    });
  }

  it("top: mitred vertices, 2 px past the top edge, 1.5 x further at the tip", () => {
    const halo = arrowHaloGeometry("top", tip, 2);
    const pts = [...halo.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(
      (m) => [halo.left + Number(m[1]), halo.top + Number(m[2])] as const,
    );
    expect(pts[0]![1]).toBeCloseTo(42 - 2, 1); // arrow top edge y = 42
    expect(pts[1]![1]).toBeCloseTo(42 - 2, 1);
    expect(pts[2]![0]).toBeCloseTo(100, 1); // tip stays centred
    expect(pts[2]![1]).toBeCloseTo(50 + 2 / Math.sin(Math.atan2(7, 8)), 1);
  });
});
