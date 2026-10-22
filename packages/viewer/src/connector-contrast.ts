// Connector contrast for burned callouts: reads the screenshot pixels under an annotation's arrow
// and stem and says whether the near-black ink would disappear there. Integer maths only, so the
// answer is a pure function of the pixels and the boxes.

import { parseHexColor } from "./color.js";
import type { Rect } from "./placement.js";

/** Decoded screenshot: opaque 8-bit RGBA, row-major. */
export interface PixelGrid {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Luma (0 to 255) under which the ink (luma 28) has too little contrast to read. */
export const DARK_LUMA = 110;
/** A connector gets a light outline when at least this share (1/3) of its pixels are dark. */
export const DARK_SHARE_NUM = 1;
export const DARK_SHARE_DEN = 3;
/** Width of the light outline painted around the ink arrow and stem, in px. */
export const CONNECTOR_HALO = 2;

/** Rec. 601 luma of one pixel, `(77 r + 150 g + 29 b) >> 8`. */
export function lumaOf(r: number, g: number, b: number): number {
  return (77 * r + 150 * g + 29 * b) >> 8;
}

/** Luma at whole-pixel (x, y); `undefined` outside the grid. */
export function lumaAt(grid: PixelGrid, x: number, y: number): number | undefined {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return undefined;
  const i = (y * grid.width + x) * 4;
  return lumaOf(grid.rgba[i]!, grid.rgba[i + 1]!, grid.rgba[i + 2]!);
}

/** Luma (0 to 255) over which a light connector has too little contrast to read; the mirror of DARK_LUMA. */
export const LIGHT_LUMA = 255 - DARK_LUMA;

/** Which end of the luma range a connector's colour sits at: `dark` ink is lost on dark pixels, `light` on light ones. */
export type ConnectorTone = "dark" | "light";

/** Dark and total pixel counts over the union-free sum of `boxes`, clipped to the grid. */
export function sampleDark(grid: PixelGrid, boxes: Rect[]): { dark: number; total: number } {
  return sampleLuma(grid, boxes, (luma) => luma < DARK_LUMA);
}

/** Light and total pixel counts, as {@link sampleDark} but for pixels at or above {@link LIGHT_LUMA}. */
export function sampleLight(grid: PixelGrid, boxes: Rect[]): { light: number; total: number } {
  const { dark: light, total } = sampleLuma(grid, boxes, (luma) => luma >= LIGHT_LUMA);
  return { light, total };
}

function sampleLuma(
  grid: PixelGrid,
  boxes: Rect[],
  hit: (luma: number) => boolean,
): { dark: number; total: number } {
  let dark = 0;
  let total = 0;
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(grid.width, Math.ceil(box.x + box.width));
    const y1 = Math.min(grid.height, Math.ceil(box.y + box.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++;
        if (hit(lumaAt(grid, x, y)!)) dark++;
      }
    }
  }
  return { dark, total };
}

/**
 * True when the ink connector would be lost on `boxes` (the arrow and stem, grown by the outline
 * width): at least a third of the pixels under them are dark. A path half on light and half on
 * dark counts as dark, since the outline costs nothing on the light part. Boxes outside the
 * image sample nothing; with no pixels at all the answer is false, today's look.
 */
export function needsConnectorHalo(
  grid: PixelGrid,
  boxes: Rect[],
  tone: ConnectorTone = "dark",
): boolean {
  if (tone === "light") {
    const { light, total } = sampleLight(grid, boxes);
    return total > 0 && light * DARK_SHARE_DEN >= total * DARK_SHARE_NUM;
  }
  const { dark, total } = sampleDark(grid, boxes);
  return total > 0 && dark * DARK_SHARE_DEN >= total * DARK_SHARE_NUM;
}

/** `light` for a colour at or above mid luma, `dark` below. */
export function toneOf(hex: string): ConnectorTone {
  const rgb = parseHexColor(hex);
  return rgb !== null && lumaOf(rgb[0], rgb[1], rgb[2]) >= 128 ? "light" : "dark";
}
