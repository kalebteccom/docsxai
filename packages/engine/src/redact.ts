// Deterministic screenshot redaction — pure pixel transforms over decoded PNGs.
//
// Boxes arrive in the screenshot's own pixel space (device pixels — selector bounding boxes are
// already devicePixelRatio-scaled by the driver; fixed regions are scaled the same way at capture
// time). Same PNG + same boxes → byte-identical output, which is what keeps redacted doc packs
// reproducible run-over-run.

import { PNG } from "pngjs";
import { type RedactionStyle } from "./doc-pack.js";

/** One rectangle to mask, in the PNG's own pixel space. */
export interface RedactionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  style: RedactionStyle;
}

const MOSAIC_TILE = 16;

/**
 * Apply redaction boxes to a PNG. `box` fills the rect with solid opaque black; `pixelate`
 * replaces it with a {@link MOSAIC_TILE}-px mosaic (each tile becomes its average colour, tiles
 * anchored at the box origin). Boxes are clamped to the image; a box that clamps to nothing is a
 * no-op. Returns a freshly encoded PNG buffer; the input is not mutated.
 */
export function applyRedactions(png: Buffer, boxes: RedactionBox[]): Buffer {
  if (boxes.length === 0) return png;
  const img = PNG.sync.read(png);
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(img.width, Math.ceil(box.x + box.width));
    const y1 = Math.min(img.height, Math.ceil(box.y + box.height));
    if (x1 <= x0 || y1 <= y0) continue;
    if (box.style === "pixelate") pixelate(img, x0, y0, x1, y1);
    else fillBlack(img, x0, y0, x1, y1);
  }
  return PNG.sync.write(img);
}

function fillBlack(img: PNG, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = 0;
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
}

function pixelate(img: PNG, x0: number, y0: number, x1: number, y1: number): void {
  for (let ty = y0; ty < y1; ty += MOSAIC_TILE) {
    for (let tx = x0; tx < x1; tx += MOSAIC_TILE) {
      const tx1 = Math.min(tx + MOSAIC_TILE, x1);
      const ty1 = Math.min(ty + MOSAIC_TILE, y1);
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      const n = (tx1 - tx) * (ty1 - ty);
      for (let y = ty; y < ty1; y++) {
        for (let x = tx; x < tx1; x++) {
          const i = (y * img.width + x) * 4;
          r += img.data[i]!;
          g += img.data[i + 1]!;
          b += img.data[i + 2]!;
          a += img.data[i + 3]!;
        }
      }
      const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
      for (let y = ty; y < ty1; y++) {
        for (let x = tx; x < tx1; x++) {
          const i = (y * img.width + x) * 4;
          img.data[i] = avg[0]!;
          img.data[i + 1] = avg[1]!;
          img.data[i + 2] = avg[2]!;
          img.data[i + 3] = avg[3]!;
        }
      }
    }
  }
}
