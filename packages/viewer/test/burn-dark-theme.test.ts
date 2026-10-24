// A themed burn on a dark screenshot: the arrow and stem take the callout's fill, so they read as
// its tail. Without a theme the outline look of burn-dark.test.ts stays, byte for byte.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, burnAnnotations, type BurnNode } from "../src/burn.js";
import { DEFAULT_BURN_THEME, THEME_PRESETS, type BurnTheme } from "../src/burn-theme.js";
import { connectorPaint, lumaOf, type PixelGrid } from "../src/connector-contrast.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { decodeScreenshot } from "../src/screenshot-pixels.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, layeredPng, pixelAt } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const W = 800;
const H = 600;
const IMAGE = { width: W, height: H, dataUri: "data:image/png;base64,AAAA" };
const DARK_BG = 24;

// A button between two text columns: the callout lands above or below it on a stem.
const BUTTON = { x: 400, y: 300, width: 30, height: 20 };
const COLUMNS = [
  { x: 60, y: 200, width: 330, height: 200 },
  { x: 440, y: 200, width: 300, height: 200 },
];
const annotation = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "gate",
  selector: "#call",
  bounding_box: BUTTON,
  copy: "Lo que va a ejecutar",
  obstacles: COLUMNS,
  ...overrides,
});

const darkShot = () => layeredPng(W, H, DARK_BG, [{ ...BUTTON, grey: 60 }]);
const lightShot = () => layeredPng(W, H, 246, [{ ...BUTTON, grey: 255 }]);
// Dark left of `darkUntil`, light right of it: a connector at x ~ 415 straddles both.
const mixedShot = (darkUntil: number) =>
  layeredPng(W, H, 246, [{ x: 0, y: 0, width: darkUntil, height: H, grey: DARK_BG }]);

const nodes = (tree: BurnNode) => (tree.props.children as BurnNode[]).slice(1);
const style = (n: BurnNode) => n.props.style!;
const rectOf = (n: BurnNode): Rect => ({
  x: style(n).left as number,
  y: style(n).top as number,
  width: style(n).width as number,
  height: style(n).height as number,
});
/** Stem and arrow: the narrow bars and the clipped triangles, outlines included. */
const connectors = (t: BurnNode) =>
  nodes(t).filter(
    (n) =>
      style(n).clipPath !== undefined ||
      (style(n).width as number) <= 6 ||
      (style(n).height as number) <= 6,
  );

// These tests are about the triangle connector, which a themed burn draws when it asks for it.
const ARROW_THEME: BurnTheme = { ...DEFAULT_BURN_THEME, connectorStyle: "arrow" };

function treeWith(shot: Buffer | undefined, theme?: BurnTheme, anns = [annotation()]) {
  return buildBurnTree({
    image: IMAGE,
    annotations: anns,
    metrics: METRICS,
    ...(theme ? { theme: { ...theme, connectorStyle: "arrow" as const } } : {}),
    ...(shot ? { pixels: decodeScreenshot(shot, W, H) } : {}),
  });
}

describe("a themed burn on a dark screenshot", () => {
  it("paints stem and arrow solid in the callout fill, where the ink ones were, with no outline", () => {
    const plain = connectors(treeWith(undefined, DEFAULT_BURN_THEME));
    const dark = connectors(treeWith(darkShot(), DEFAULT_BURN_THEME));
    expect(plain.length).toBe(2);
    expect(dark.map(rectOf)).toEqual(plain.map(rectOf));
    expect(dark.map((n) => style(n).backgroundColor)).toEqual(["#fff", "#fff"]);
  });

  it("uses the preset's own fill", () => {
    const readable = { ...THEME_PRESETS.readable, fontFile: null, scale: 1 } as BurnTheme;
    const dark = connectors(treeWith(darkShot(), readable));
    expect(dark.map((n) => style(n).backgroundColor)).toEqual(["#fafafa", "#fafafa"]);
  });

  it("draws a light stem the burned PNG shows against the dark page", async () => {
    const png = decodePng(
      await burnAnnotations({
        screenshotBuffer: darkShot(),
        annotations: [annotation()],
        options: { theme: ARROW_THEME },
      }),
    );
    const stem = connectors(treeWith(darkShot(), DEFAULT_BURN_THEME)).find(
      (n) => style(n).clipPath === undefined,
    )!;
    const s = rectOf(stem);
    const [r, g, b] = pixelAt(png, Math.floor(s.x + s.width / 2), Math.floor(s.y + s.height / 2));
    expect(lumaOf(r, g, b)).toBeGreaterThan(230);
    // and nothing is painted beside it: the outline is gone
    const [r2, g2, b2] = pixelAt(png, Math.floor(s.x) - 2, Math.floor(s.y + s.height / 2));
    expect(lumaOf(r2, g2, b2)).toBe(DARK_BG);
  });

  it("keeps the outline over a mix of dark and light pixels, where a light stem would vanish", () => {
    const mixed = connectors(treeWith(mixedShot(415), DEFAULT_BURN_THEME));
    expect(mixed.map((n) => style(n).backgroundColor)).toEqual([
      "#ffffff",
      "#ffffff",
      "#1c1c1c",
      "#1c1c1c",
    ]);
  });

  it("changes nothing on a light screenshot", () => {
    expect(treeWith(lightShot(), DEFAULT_BURN_THEME)).toEqual(
      treeWith(undefined, DEFAULT_BURN_THEME),
    );
  });

  it("keeps the outline without a theme, as before", () => {
    const outlined = connectors(treeWith(darkShot()));
    expect(outlined.map((n) => style(n).backgroundColor)).toEqual([
      "#ffffff",
      "#ffffff",
      "#1c1c1c",
      "#1c1c1c",
    ]);
  });

  it("keeps plain ink when the outline is switched off", async () => {
    const run = (theme?: BurnTheme) =>
      burnAnnotations({
        screenshotBuffer: darkShot(),
        annotations: [annotation()],
        options: { connector: "off", ...(theme ? { theme } : {}) },
      });
    const off = decodePng(await run(ARROW_THEME));
    const s = rectOf(
      connectors(treeWith(darkShot(), DEFAULT_BURN_THEME)).find(
        (n) => style(n).clipPath === undefined,
      )!,
    );
    const [r, g, b] = pixelAt(off, Math.floor(s.x + s.width / 2), Math.floor(s.y + s.height / 2));
    expect(lumaOf(r, g, b)).toBeLessThan(60);
  });
});

describe("connectorPaint", () => {
  const grid = (luma: (x: number) => number, width = 100, height = 10): PixelGrid => {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba.fill(luma(x), i, i + 3);
        rgba[i + 3] = 255;
      }
    }
    return { width, height, rgba };
  };
  const all: Rect[] = [{ x: 0, y: 0, width: 100, height: 10 }];

  it("keeps ink where it reads", () => {
    expect(
      connectorPaint(
        grid(() => 240),
        all,
        "dark",
        "light",
      ),
    ).toBe("ink");
  });

  it("fills a dark path with a light callout colour", () => {
    expect(
      connectorPaint(
        grid(() => 20),
        all,
        "dark",
        "light",
      ),
    ).toBe("fill");
  });

  it("outlines when a tenth or more of the path matches the fill", () => {
    expect(
      connectorPaint(
        grid((x) => (x < 91 ? 20 : 240)),
        all,
        "dark",
        "light",
      ),
    ).toBe("fill");
    expect(
      connectorPaint(
        grid((x) => (x < 90 ? 20 : 240)),
        all,
        "dark",
        "light",
      ),
    ).toBe("outline");
  });

  it("outlines without a fill, or with one of the ink's own tone", () => {
    expect(
      connectorPaint(
        grid(() => 20),
        all,
        "dark",
      ),
    ).toBe("outline");
    expect(
      connectorPaint(
        grid(() => 20),
        all,
        "dark",
        "dark",
      ),
    ).toBe("outline");
  });

  it("mirrors for a light connector on light pixels with a dark callout", () => {
    expect(
      connectorPaint(
        grid(() => 250),
        all,
        "light",
        "dark",
      ),
    ).toBe("fill");
    expect(
      connectorPaint(
        grid(() => 20),
        all,
        "light",
        "dark",
      ),
    ).toBe("ink");
  });
});
