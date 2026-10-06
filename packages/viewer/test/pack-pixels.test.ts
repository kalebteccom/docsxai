import { describe, expect, it } from "vitest";
import type { PixelGrid } from "../src/connector-contrast.js";
import { diffGrids, diffPngs } from "../src/pack-pixels.js";
import { withTextChunk } from "./helpers/pack-fixtures.js";
import { layeredPng, solidPng } from "./helpers/png.js";

function grid(width: number, height: number, changed: Array<[number, number]> = []): PixelGrid {
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (const [x, y] of changed) rgba.set([0, 0, 0, 255], (y * width + x) * 4);
  return { width, height, rgba };
}

describe("diffGrids", () => {
  it("reports no change, no region and 0 percent for equal grids", () => {
    expect(diffGrids(grid(10, 10), grid(10, 10))).toEqual({
      kind: "pixels",
      changed: 0,
      pct: 0,
      region: null,
    });
  });

  it("counts changed pixels over the full area and boxes them", () => {
    const diff = diffGrids(
      grid(20, 20),
      grid(20, 20, [
        [5, 6],
        [8, 9],
        [5, 9],
      ]),
    );
    expect(diff).toEqual({
      kind: "pixels",
      changed: 3,
      pct: 0.75,
      region: { x: 5, y: 6, width: 4, height: 4 },
    });
  });

  it("gives a single pixel a 1x1 region", () => {
    expect(diffGrids(grid(10, 10), grid(10, 10, [[3, 4]]))).toMatchObject({
      changed: 1,
      pct: 1,
      region: { x: 3, y: 4, width: 1, height: 1 },
    });
  });

  it("rounds the percentage to four decimals", () => {
    const diff = diffGrids(grid(300, 300), grid(300, 300, [[1, 1]]));
    expect(diff).toMatchObject({ kind: "pixels", pct: 0.0011 });
  });

  it("sees a change in any one channel, alpha included", () => {
    const a = grid(2, 1);
    for (const channel of [0, 1, 2, 3]) {
      const b = grid(2, 1);
      b.rgba[4 + channel] = 7;
      expect(diffGrids(a, b)).toMatchObject({ changed: 1, region: { x: 1, y: 0 } });
    }
  });

  it("reports a different size as resized", () => {
    expect(diffGrids(grid(10, 10), grid(12, 10))).toEqual({
      kind: "resized",
      from: { width: 10, height: 10 },
      to: { width: 12, height: 10 },
    });
  });
});

describe("diffPngs", () => {
  it("compares real PNGs: a painted block is changed pixels with its region", () => {
    const a = layeredPng(20, 20, 255);
    const b = layeredPng(20, 20, 255, [{ x: 5, y: 6, width: 4, height: 4, grey: 0 }]);
    expect(diffPngs(a, b)).toEqual({
      kind: "pixels",
      changed: 16,
      pct: 4,
      region: { x: 5, y: 6, width: 4, height: 4 },
    });
  });

  it("finds no change between a PNG and a byte-different copy with the same pixels", () => {
    const a = layeredPng(20, 20, 200);
    const b = withTextChunk(a);
    expect(b.equals(a)).toBe(false);
    expect(diffPngs(a, b)).toMatchObject({ kind: "pixels", changed: 0, pct: 0, region: null });
  });

  it("reports resized from the headers, without decoding", () => {
    expect(diffPngs(solidPng(20, 20), solidPng(22, 20))).toEqual({
      kind: "resized",
      from: { width: 20, height: 20 },
      to: { width: 22, height: 20 },
    });
  });

  it("reads transparent pixels as white", () => {
    const clear = solidPng(4, 4, [0, 0, 0, 0]);
    const white = solidPng(4, 4, [255, 255, 255, 255]);
    expect(diffPngs(clear, white)).toMatchObject({ changed: 0 });
  });

  it("throws on something that is not a PNG", () => {
    expect(() => diffPngs(Buffer.from("nope"), solidPng(4, 4))).toThrow(/not a PNG/);
  });
});
