import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, renderBurn, type BurnNode } from "../src/burn.js";
import {
  DEFAULT_BURN_THEME,
  THEME_PRESET_NAMES,
  type BurnTheme,
  type ThemePresetName,
} from "../src/burn-theme.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { parseHexColor } from "../src/color.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);

// The fixed annotation fixture: a white 400x300 screenshot, one numbered target with a callout
// above it. Every preset renders this same input.
const SCREENSHOT = solidPng(400, 300);
const BOX = { x: 150, y: 120, width: 80, height: 40 };
const FIXTURE: AnnotationRecord[] = [
  {
    step: "open-sidebar",
    selector: "#play",
    bounding_box: BOX,
    copy: "Click Play to open the recap sidebar",
    index: 1,
  },
];

const themeOf = (block: unknown): BurnTheme =>
  resolveBurnTheme(parseThemeConfig(block), { workspace: "/tmp/docsxai-theme-workspace" });

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => [...parseHexColor(hex)!] as Rgb;
const near = (px: number[], want: Rgb, tolerance = 8) =>
  want.every((c, i) => Math.abs(px[i]! - c) <= tolerance);
const channelDistance = (a: number[], b: Rgb) =>
  Math.abs(a[0]! - b[0]) + Math.abs(a[1]! - b[1]) + Math.abs(a[2]! - b[2]);

/** Burns the fixture and samples the halo, callout and badge at coordinates the report gives. */
async function sample(theme: BurnTheme | undefined) {
  const { png, report } = await renderBurn({
    screenshotBuffer: SCREENSHOT,
    annotations: structuredClone(FIXTURE),
    ...(theme ? { options: { theme } } : {}),
  });
  const img = decodePng(png);
  const [entry] = report;
  const callout = entry!.callout!;
  const badge = entry!.badge!;
  const cx = Math.floor(callout.x);
  return {
    png,
    img,
    callout,
    badge,
    halo: pixelAt(img, BOX.x + 40, BOX.y + 1),
    calloutBackground: pixelAt(img, cx + 6, Math.round(callout.y) + 6),
    calloutBorder: pixelAt(img, cx + Math.floor(callout.width / 2), Math.round(callout.y)),
    badgeFill: pixelAt(img, Math.round(badge.x) + 4, Math.round(badge.y + badge.height / 2)),
    // The darkest pixel of the callout's text rows.
    darkestText: (() => {
      let darkest = [255, 255, 255, 255];
      const top = Math.round(callout.y) + 12;
      for (let y = top; y < top + 12; y++) {
        for (let x = cx + 16; x < cx + callout.width - 16; x++) {
          const px = pixelAt(img, x, y);
          if (px[0] + px[1] + px[2] < darkest[0]! + darkest[1]! + darkest[2]!) darkest = px;
        }
      }
      return darkest;
    })(),
  };
}

describe("the default theme", () => {
  it("renders the same bytes as no theme at all", async () => {
    const plain = await sample(undefined);
    const explicit = await sample(DEFAULT_BURN_THEME);
    expect(explicit.png.equals(plain.png)).toBe(true);
  });

  it("builds the same tree as no theme at all", () => {
    const input = {
      image: { width: 400, height: 300, dataUri: "data:image/png;base64,AAAA" },
      annotations: structuredClone(FIXTURE),
      metrics: METRICS,
    };
    expect(buildBurnTree({ ...input, theme: DEFAULT_BURN_THEME })).toEqual(buildBurnTree(input));
  });

  it("draws the orange halo, white callout, near-black outline and badge it always did", async () => {
    const s = await sample(undefined);
    expect(near(s.halo, [0xe8, 0x59, 0x0c])).toBe(true);
    expect(near(s.calloutBackground, [255, 255, 255])).toBe(true);
    expect(near(s.calloutBorder, [0x1c, 0x1c, 0x1c])).toBe(true);
    expect(near(s.badgeFill, [0xc2, 0x41, 0x0c])).toBe(true);
  });
});

describe.each(THEME_PRESET_NAMES)("the %s preset", (name: ThemePresetName) => {
  const theme = themeOf({ preset: name });

  it("draws its accent on the halo, its background and outline on the callout, its fill on the badge", async () => {
    const s = await sample(theme);
    expect(near(s.halo, rgbOf(theme.accent)), `halo ${s.halo}`).toBe(true);
    expect(
      near(s.calloutBackground, rgbOf(theme.calloutBackground)),
      `bg ${s.calloutBackground}`,
    ).toBe(true);
    expect(
      near(s.calloutBorder, rgbOf(theme.calloutBorderColor)),
      `border ${s.calloutBorder}`,
    ).toBe(true);
    expect(near(s.badgeFill, rgbOf(theme.badgeFill)), `badge ${s.badgeFill}`).toBe(true);
  });

  it("sets its text in its ink colour", async () => {
    const s = await sample(theme);
    // Antialiasing keeps most glyph pixels off the pure ink colour; the darkest one sits nearer
    // to the ink than to the callout's background.
    expect(channelDistance(s.darkestText, rgbOf(theme.ink))).toBeLessThan(
      channelDistance(s.darkestText, rgbOf(theme.calloutBackground)),
    );
  });

  it("leaves the far corners of the screenshot untouched", async () => {
    const s = await sample(theme);
    expect(pixelAt(s.img, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(s.img, 396, 296)).toEqual([255, 255, 255, 255]);
  });

  it("burns the same bytes every time", async () => {
    const first = await sample(theme);
    const second = await sample(theme);
    expect(createHash("sha256").update(first.png).digest("hex")).toBe(
      createHash("sha256").update(second.png).digest("hex"),
    );
  });
});

describe("the presets side by side", () => {
  it("burn five different images", async () => {
    const hashes = new Set<string>();
    for (const theme of [
      DEFAULT_BURN_THEME,
      ...THEME_PRESET_NAMES.map((n) => themeOf({ preset: n })),
    ]) {
      hashes.add(
        createHash("sha256")
          .update((await sample(theme)).png)
          .digest("hex"),
      );
    }
    expect(hashes.size).toBe(5);
  });

  it("size the callout from the theme's type and padding", async () => {
    const base = await sample(DEFAULT_BURN_THEME);
    const roomy = await sample(
      themeOf({ padding_x: 20, padding_y: 14, font_size: 16, line_height: 24 }),
    );
    expect(roomy.callout.height).toBeGreaterThan(base.callout.height);
  });

  it("draws the badge in the shape the theme names", () => {
    const radiusOf = (shape: string) => {
      const tree = buildBurnTree({
        image: { width: 400, height: 300, dataUri: "data:image/png;base64,AAAA" },
        annotations: structuredClone(FIXTURE),
        metrics: METRICS,
        theme: themeOf({ badge_shape: shape }),
      });
      const badge = (tree.props.children as BurnNode[]).find(
        (n) => n.props.style?.backgroundColor === DEFAULT_BURN_THEME.badgeFill,
      );
      return badge!.props.style!.borderRadius;
    };
    expect(radiusOf("circle")).toBe(13);
    expect(radiusOf("rounded")).toBe(6);
    expect(radiusOf("square")).toBe(0);
  });

  it("puts the callout's shadow in the tree only when the theme has one", () => {
    const shadowOf = (theme: BurnTheme) => {
      const tree = buildBurnTree({
        image: { width: 400, height: 300, dataUri: "data:image/png;base64,AAAA" },
        annotations: structuredClone(FIXTURE),
        metrics: METRICS,
        theme,
      });
      const callout = (tree.props.children as BurnNode[]).find(
        (n) => n.props.style?.backgroundColor === theme.calloutBackground,
      );
      return callout!.props.style!.boxShadow;
    };
    expect(shadowOf(DEFAULT_BURN_THEME)).toBeUndefined();
    expect(shadowOf(themeOf({ preset: "clean" }))).toBe("0px 2px 8px 0px rgba(17,24,39,0.18)");
  });
});

describe("a light connector", () => {
  it("is outlined in dark ink over light pixels, and left plain over dark ones", async () => {
    const light = themeOf({
      callout_background: "#111111",
      ink: "#ffffff",
      callout_border_color: "#f5f5f5",
    });
    const onWhite = buildBurnTree({
      image: { width: 400, height: 300, dataUri: "data:image/png;base64,AAAA" },
      annotations: structuredClone(FIXTURE),
      metrics: METRICS,
      theme: light,
      pixels: { width: 400, height: 300, rgba: new Uint8Array(400 * 300 * 4).fill(255) },
    });
    const onBlack = buildBurnTree({
      image: { width: 400, height: 300, dataUri: "data:image/png;base64,AAAA" },
      annotations: structuredClone(FIXTURE),
      metrics: METRICS,
      theme: light,
      pixels: { width: 400, height: 300, rgba: new Uint8Array(400 * 300 * 4).fill(0) },
    });
    const arrows = (tree: BurnNode) =>
      (tree.props.children as BurnNode[]).filter((n) => n.props.style?.clipPath);
    expect(arrows(onWhite)).toHaveLength(2);
    expect(arrows(onWhite)[0]!.props.style!.backgroundColor).toBe("#1c1c1c");
    expect(arrows(onWhite)[1]!.props.style!.backgroundColor).toBe("#f5f5f5");
    expect(arrows(onBlack)).toHaveLength(1);
    expect(arrows(onBlack)[0]!.props.style!.backgroundColor).toBe("#f5f5f5");
  });
});
