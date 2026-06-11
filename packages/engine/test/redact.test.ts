// applyRedactions pixel math over tiny synthetic PNGs — exact-pixel assertions, no browser.

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { applyRedactions } from "../src/redact.js";

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];

function makePng(width: number, height: number, colorAt: (x: number, y: number) => Rgba): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = colorAt(x, y);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  return PNG.sync.write(img);
}

function pixelAt(png: Buffer, x: number, y: number): Rgba {
  const img = PNG.sync.read(png);
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

describe("applyRedactions — box", () => {
  it("fills exactly the box with opaque black and leaves the rest untouched", () => {
    const out = applyRedactions(
      makePng(10, 10, () => WHITE),
      [{ x: 2, y: 3, width: 4, height: 5, style: "box" }],
    );
    expect(pixelAt(out, 2, 3)).toEqual(BLACK); // top-left corner inside
    expect(pixelAt(out, 5, 7)).toEqual(BLACK); // bottom-right corner inside
    expect(pixelAt(out, 1, 3)).toEqual(WHITE); // left of the box
    expect(pixelAt(out, 6, 3)).toEqual(WHITE); // right of the box
    expect(pixelAt(out, 2, 2)).toEqual(WHITE); // above
    expect(pixelAt(out, 2, 8)).toEqual(WHITE); // below
  });

  it("expands fractional coordinates outward (floor origin, ceil extent) so the element is fully covered", () => {
    const out = applyRedactions(
      makePng(10, 10, () => WHITE),
      [{ x: 2.6, y: 2.6, width: 2.8, height: 2.8, style: "box" }],
    );
    expect(pixelAt(out, 2, 2)).toEqual(BLACK); // floor(2.6) = 2
    expect(pixelAt(out, 5, 5)).toEqual(BLACK); // ceil(2.6 + 2.8) = 6 → last covered px is 5
    expect(pixelAt(out, 1, 1)).toEqual(WHITE);
    expect(pixelAt(out, 6, 6)).toEqual(WHITE);
  });

  it("clamps a box that overflows the image instead of throwing", () => {
    const out = applyRedactions(
      makePng(8, 8, () => WHITE),
      [{ x: 6, y: 6, width: 100, height: 100, style: "box" }],
    );
    expect(pixelAt(out, 7, 7)).toEqual(BLACK);
    expect(pixelAt(out, 5, 5)).toEqual(WHITE);
  });

  it("a box entirely outside the image is a no-op; an empty box list returns the input buffer as-is", () => {
    const png = makePng(8, 8, () => WHITE);
    const out = applyRedactions(png, [{ x: 50, y: 50, width: 10, height: 10, style: "box" }]);
    expect(pixelAt(out, 4, 4)).toEqual(WHITE);
    expect(applyRedactions(png, [])).toBe(png);
  });

  it("is deterministic — same PNG + same boxes → byte-identical output", () => {
    const png = makePng(16, 16, (x) => (x < 8 ? RED : BLUE));
    const boxes = [{ x: 2, y: 2, width: 5, height: 5, style: "box" as const }];
    expect(applyRedactions(png, boxes).equals(applyRedactions(png, boxes))).toBe(true);
  });
});

describe("applyRedactions — pixelate", () => {
  it("averages each 16-px tile (a half-red / half-blue tile becomes the blended colour)", () => {
    // 16×16 image: top half red, bottom half blue → one mosaic tile, average = (128, 0, 128, 255).
    const png = makePng(16, 16, (_x, y) => (y < 8 ? RED : BLUE));
    const out = applyRedactions(png, [{ x: 0, y: 0, width: 16, height: 16, style: "pixelate" }]);
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
      [8, 8],
    ] as const) {
      expect(pixelAt(out, x, y)).toEqual([128, 0, 128, 255]);
    }
  });

  it("tiles are anchored at the box origin, and a partial tile averages only its own pixels", () => {
    // 32×16 image, left half red / right half blue. Pixelate x:8..24 → tile 1 covers x 8..23 …
    // except the box is 16 wide so tile 1 is the whole box: avg of 8 red + 8 blue columns.
    const png = makePng(32, 16, (x) => (x < 16 ? RED : BLUE));
    const out = applyRedactions(png, [{ x: 8, y: 0, width: 16, height: 16, style: "pixelate" }]);
    expect(pixelAt(out, 8, 0)).toEqual([128, 0, 128, 255]);
    expect(pixelAt(out, 23, 15)).toEqual([128, 0, 128, 255]);
    // Outside the box: original colours.
    expect(pixelAt(out, 7, 0)).toEqual(RED);
    expect(pixelAt(out, 24, 0)).toEqual(BLUE);
  });

  it("a uniform region pixelates to itself (average of a constant is the constant)", () => {
    const png = makePng(20, 20, () => RED);
    const out = applyRedactions(png, [{ x: 0, y: 0, width: 20, height: 20, style: "pixelate" }]);
    expect(pixelAt(out, 0, 0)).toEqual(RED);
    expect(pixelAt(out, 19, 19)).toEqual(RED);
  });
});
