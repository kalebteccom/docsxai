// Screenshot pixels for the burner's contrast checks. The burner has no PNG decoder of its own:
// resvg, which already rasterises the burned frame, draws the screenshot 1:1 onto white and hands
// back the RGBA. That covers every PNG flavour resvg reads (palette, 16-bit, interlaced, alpha),
// and the result is a pure function of the file's bytes.

import { Resvg } from "@resvg/resvg-js";
import type { PixelGrid } from "./connector-contrast.js";

/** Decodes a PNG of known size to opaque RGBA; transparent areas read as white. */
export function decodeScreenshot(png: Buffer, width: number, height: number): PixelGrid {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<image width="${width}" height="${height}" image-rendering="optimizeSpeed" ` +
    `href="data:image/png;base64,${png.toString("base64")}"/></svg>`;
  const out = new Resvg(svg, {
    background: "#ffffff",
    font: { loadSystemFonts: false },
  }).render();
  return { width: out.width, height: out.height, rgba: new Uint8Array(out.pixels) };
}
