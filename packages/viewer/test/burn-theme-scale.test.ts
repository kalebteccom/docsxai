import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import { widthLadder } from "../src/burn-callout.js";
import {
  DEFAULT_BURN_THEME,
  THEME_PRESETS,
  captionScale,
  contrastWarnings,
  weightWarnings,
  type BurnTheme,
} from "../src/burn-theme.js";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { parseHexColor } from "../src/color.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

// The triangle connector, so a themed burn at scale 1 can be compared with an unthemed one byte for
// byte; the line connector's own scaling is in burn-line.test.ts.
const themeOf = (block: unknown): BurnTheme =>
  resolveBurnTheme(
    parseThemeConfig(
      typeof block === "object" && block !== null ? { connector_style: "arrow", ...block } : block,
    ),
    { workspace: "/tmp/docsxai-theme-workspace" },
  );

const problemsOf = (block: unknown): string[] => {
  try {
    themeOf(block);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems;
  }
  throw new Error("the block was accepted");
};

const BOX = { x: 150, y: 360, width: 240, height: 120 };
const fixture = (): AnnotationRecord[] => [
  {
    step: "open-sidebar",
    selector: "#play",
    bounding_box: { ...BOX },
    copy: "Click Play to open the recap sidebar",
    index: 1,
  },
];

async function burn(
  width: number,
  height: number,
  theme?: BurnTheme,
  annotations: AnnotationRecord[] = fixture(),
) {
  const { png, report } = await renderBurn({
    screenshotBuffer: solidPng(width, height),
    annotations,
    ...(theme ? { options: { theme } } : {}),
  });
  return { png, entry: report[0]!, img: decodePng(png) };
}

// The unthemed 1200x900 burn is the baseline of three tests; one burn serves them all, and nothing
// writes to its result.
let plain1200: ReturnType<typeof burn> | undefined;
const plainBurn = () => (plain1200 ??= burn(1200, 900));

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const near = (px: number[], hex: string, tolerance = 8) =>
  [...parseHexColor(hex)!].every((c, i) => Math.abs(px[i]! - c) <= tolerance);

describe("captionScale", () => {
  it("is the number a theme gives", () => {
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: 2 }, 1440)).toBe(2);
    expect(captionScale(DEFAULT_BURN_THEME, 5000)).toBe(1);
  });

  it("is the screenshot width over the display width for auto", () => {
    const auto = { ...DEFAULT_BURN_THEME, scale: "auto" as const };
    expect(captionScale(auto, 1440)).toBe(2);
    expect(captionScale({ ...auto, displayWidth: 600 }, 1200)).toBe(2);
  });

  it("is 1 for a screenshot narrower than its display width", () => {
    const auto = { ...DEFAULT_BURN_THEME, scale: "auto" as const };
    expect(captionScale(auto, 390)).toBe(1);
    expect(captionScale(auto, 720)).toBe(1);
  });

  it("stops at 4 for auto", () => {
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: "auto" }, 4000)).toBe(4);
  });

  it("gives 4 for a 1440 px screenshot shown at 360 px", () => {
    expect(captionScale({ ...DEFAULT_BURN_THEME, scale: "auto", displayWidth: 360 }, 1440)).toBe(4);
  });

  it("rounds up to 2 decimals so a 780 px screenshot shown at 358 px keeps its base size", () => {
    const factor = captionScale({ ...DEFAULT_BURN_THEME, scale: "auto", displayWidth: 358 }, 780);
    expect(factor).toBe(2.18);
    expect(12 * factor * (358 / 780)).toBeGreaterThanOrEqual(12);
  });
});

describe("scale in a burn", () => {
  it("makes the callout and the halo outline twice as large at scale 2", async () => {
    const one = await plainBurn();
    const two = await burn(1200, 900, themeOf({ scale: 2 }));
    expect(two.entry.callout!.width / one.entry.callout!.width).toBeCloseTo(2, 1);
    expect(two.entry.callout!.height / one.entry.callout!.height).toBeCloseTo(2, 1);
    expect(two.entry.badge!.height / one.entry.badge!.height).toBeCloseTo(2, 1);

    // The halo's outline doubles too.
    const mid = BOX.x + BOX.width / 2;
    // The halo outline is 2 px wide at scale 1 and 4 px at scale 2.
    expect(near(pixelAt(one.img, mid, BOX.y + 3), DEFAULT_BURN_THEME.accent)).toBe(false);
    expect(near(pixelAt(two.img, mid, BOX.y + 3), DEFAULT_BURN_THEME.accent)).toBe(true);
  });

  it("burns the same bytes at auto on a 1440 px screenshot with display_width 720 as at scale 2", async () => {
    const auto = await burn(1440, 900, themeOf({ scale: "auto", display_width: 720 }));
    const two = await burn(1440, 900, themeOf({ scale: 2 }));
    expect(sha(auto.png)).toBe(sha(two.png));
  });

  it("burns the same bytes at auto on a 390 px screenshot as at scale 1", async () => {
    const small: AnnotationRecord[] = [
      { ...fixture()[0]!, bounding_box: { x: 100, y: 150, width: 120, height: 40 } },
    ];
    const auto = await burn(390, 300, themeOf({ scale: "auto" }), structuredClone(small));
    const one = await burn(390, 300, undefined, structuredClone(small));
    expect(sha(auto.png)).toBe(sha(one.png));
  });

  it("burns the same bytes at scale 1 as with no theme", async () => {
    const plain = await plainBurn();
    const explicit = await burn(1200, 900, themeOf({ scale: 1 }));
    const defaults = await burn(1200, 900, { ...DEFAULT_BURN_THEME, connectorStyle: "arrow" });
    expect(sha(explicit.png)).toBe(sha(plain.png));
    expect(sha(defaults.png)).toBe(sha(plain.png));
  });
});

describe("the new sizing keys", () => {
  it("move the callout away from its target with arrow_size", async () => {
    const one = await plainBurn();
    const long = await burn(1200, 900, themeOf({ arrow_size: 20 }));
    const gap = (r: { callout: { y: number; height: number } | null }) =>
      BOX.y - (r.callout!.y + r.callout!.height);
    expect(gap(long.entry)).toBe(gap(one.entry) + 12);
  });

  it("narrow an obstacle-limited callout with max_width_ratio", async () => {
    const withObstacle = (): AnnotationRecord[] => [
      {
        ...fixture()[0]!,
        bounding_box: { x: 100, y: 400, width: 120, height: 40 },
        obstacles: [{ x: 0, y: 0, width: 10, height: 10 }],
      },
    ];
    const wide = await burn(400, 900, undefined, withObstacle());
    const narrow = await burn(400, 900, themeOf({ max_width_ratio: 0.4 }), withObstacle());
    expect(narrow.entry.callout!.width).toBeLessThan(wide.entry.callout!.width);
  });
});

describe("the readable preset", () => {
  const readable = themeOf({ preset: "readable" });

  it("is auto scaled at 15 px type with 10 and 14 px padding and an 8 px radius", () => {
    expect(readable.scale).toBe("auto");
    expect(readable.fontSize).toBe(15);
    expect([readable.paddingY, readable.paddingX, readable.radius]).toEqual([10, 14, 8]);
    expect(readable.shadow).toContain("12px");
  });

  it("limits a callout to 55% of the screenshot, with or without obstacles", () => {
    expect(readable.maxWidthRatio).toBe(0.55);
    expect(widthLadder(358, false, undefined, readable.maxWidthRatio)[0]).toBe(197);
    expect(widthLadder(358, true, undefined, readable.maxWidthRatio)[0]).toBe(197);
    expect(widthLadder(720, false, undefined, readable.maxWidthRatio)).toEqual([280]);
    expect(widthLadder(358, false)).toEqual([280]);
  });

  it("reads at 14 px or more on screen at both case-study widths", () => {
    const px = (imageWidth: number, shown: number, size: number) =>
      size * captionScale({ ...readable, displayWidth: shown }, imageWidth) * (shown / imageWidth);
    expect(px(1440, 720, readable.fontSize)).toBeGreaterThanOrEqual(14);
    expect(px(780, 358, readable.fontSize)).toBeGreaterThanOrEqual(13);
    expect(px(1440, 360, readable.fontSize)).toBeGreaterThanOrEqual(14);
    expect(px(1440, 720, 12)).toBeGreaterThanOrEqual(12);
    expect(px(780, 358, 12)).toBeGreaterThanOrEqual(12);
    expect(px(780, 358, 2)).toBeGreaterThanOrEqual(2);
  });

  it("keeps every text pair at WCAG AA", () => {
    expect(contrastWarnings(readable)).toEqual([]);
    expect(THEME_PRESETS.readable.ink).toBe("#111827");
    expect(THEME_PRESETS.readable.calloutBackground).toBe("#fafafa");
  });

  it("draws a larger callout on a 1440 px screenshot than on a 390 px one", async () => {
    const wide = await burn(1440, 900, readable);
    const narrow = await burn(390, 900, readable, [
      { ...fixture()[0]!, bounding_box: { x: 100, y: 400, width: 120, height: 40 } },
    ]);
    expect(wide.entry.callout!.height).toBeGreaterThan(narrow.entry.callout!.height);
  });
});

describe("validation of the sizing keys", () => {
  it.each([
    [{ scale: 0 }, "scale: 0 is outside the range 0.5 to 4"],
    [{ scale: 5 }, "scale: 5 is outside the range 0.5 to 4"],
    [{ scale: "big" }, 'scale: "big" is not a scale'],
    [{ display_width: 100 }, "display_width: 100 is outside the range 240 to 2400"],
    [{ font_weight: 500 }, "font_weight: 500 is not a supported weight"],
    [{ max_width_ratio: 2 }, "max_width_ratio: 2 is outside the range 0.2 to 1"],
    [{ max_width_ratio: "wide" }, 'max_width_ratio: "wide" is not a number'],
    [{ arrow_size: 2 }, "arrow_size: 2 is outside the range 4 to 24"],
  ])("refuses %j", (block, message) => {
    expect(problemsOf(block)[0]).toContain(message);
  });

  it("warns when a weight needs a font file the theme lacks", () => {
    expect(weightWarnings(themeOf({ font_weight: 600 }))[0]).toContain("font_weight 600");
    expect(weightWarnings(themeOf({ font_weight: 600, font: "fonts/brand.ttf" }))).toEqual([]);
    expect(weightWarnings(DEFAULT_BURN_THEME)).toEqual([]);
  });
});
