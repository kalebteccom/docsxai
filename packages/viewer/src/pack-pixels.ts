// Pixel comparison for `docsxai drift`: exact RGBA over the full image, with the changed share
// and the bounding box of what changed. PNGs decode through the burner's resvg path
// (screenshot-pixels.ts), so the viewer carries no second PNG library. Transparent pixels read
// as white, as they do for the burner's contrast check.

import type { BoundingBox } from "./annotations.js";
import { pngDimensions } from "./burn.js";
import type { PixelGrid } from "./connector-contrast.js";
import { decodeScreenshot } from "./screenshot-pixels.js";

export interface Size {
  width: number;
  height: number;
}

export type PixelDiff =
  | {
      kind: "pixels";
      changed: number;
      /** Changed pixels over the full area, in percent, rounded to 4 decimals. */
      pct: number;
      /** Smallest box holding every changed pixel; `null` when nothing changed. */
      region: BoundingBox | null;
    }
  | { kind: "resized"; from: Size; to: Size };

/** Compares two grids of the same size. */
export function diffGrids(a: PixelGrid, b: PixelGrid): PixelDiff {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      kind: "resized",
      from: { width: a.width, height: a.height },
      to: { width: b.width, height: b.height },
    };
  }
  let changed = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (
        a.rgba[i] === b.rgba[i] &&
        a.rgba[i + 1] === b.rgba[i + 1] &&
        a.rgba[i + 2] === b.rgba[i + 2] &&
        a.rgba[i + 3] === b.rgba[i + 3]
      ) {
        continue;
      }
      changed++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const area = a.width * a.height;
  return {
    kind: "pixels",
    changed,
    pct: area === 0 ? 0 : Math.round((changed / area) * 100 * 10000) / 10000,
    region:
      changed === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function decode(png: Buffer): PixelGrid {
  const { width, height } = pngDimensions(png);
  return decodeScreenshot(png, width, height);
}

/** Compares two PNG files. A size change is reported as `resized` without decoding. */
export function diffPngs(a: Buffer, b: Buffer): PixelDiff {
  const sa = pngDimensions(a);
  const sb = pngDimensions(b);
  if (sa.width !== sb.width || sa.height !== sb.height)
    return { kind: "resized", from: sa, to: sb };
  return diffGrids(decode(a), decode(b));
}
