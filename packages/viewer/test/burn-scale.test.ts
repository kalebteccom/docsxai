// The caption-scale helpers on their own (burn-scale.ts, scaledTheme, captionScale), the edges of
// the sizing keys, and what a tree looks like at scale 0.5 and 4, with no annotations and on a
// one-pixel screenshot.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { buildBurnTree, pngDimensions, renderBurn, type BurnNode } from "../src/burn.js";
import type { CalloutLayout } from "../src/burn-callout.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { atBaseSize, layoutAtScale, scalePoint, scaleRect } from "../src/burn-scale.js";
import {
  DEFAULT_BURN_THEME,
  captionScale,
  scaledTheme,
  type BurnTheme,
} from "../src/burn-theme.js";
import { BurnThemeError, parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { solidPng } from "./helpers/png.js";

const METRICS = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);
const WORKSPACE = path.resolve("/tmp/docsxai-theme-workspace");
const themeOf = (block: unknown): BurnTheme =>
  resolveBurnTheme(parseThemeConfig(block), { workspace: WORKSPACE });
const problemOf = (block: unknown): string => {
  try {
    themeOf(block);
  } catch (e) {
    expect(e).toBeInstanceOf(BurnThemeError);
    return (e as BurnThemeError).problems[0]!;
  }
  throw new Error("the block was accepted");
};

const ann = (over: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "s",
  selector: "#a",
  copy: "Click Play",
  ...over,
});

describe("scaleRect and scalePoint", () => {
  it("hand back the same object at factor 1", () => {
    const r = { x: 1, y: 2, width: 3, height: 4 };
    expect(scaleRect(r, 1)).toBe(r);
    const p = { x: 1, y: 2 };
    expect(scalePoint(p, 1)).toBe(p);
  });

  it("multiply every field, down to 0.5 and up to 4", () => {
    expect(scaleRect({ x: 10, y: 20, width: 30, height: 40 }, 0.5)).toEqual({
      x: 5,
      y: 10,
      width: 15,
      height: 20,
    });
    expect(scalePoint({ x: 3, y: -5 }, 4)).toEqual({ x: 12, y: -20 });
  });
});

describe("atBaseSize", () => {
  it("is the same record at factor 1", () => {
    const a = ann({ bounding_box: { x: 1, y: 2, width: 3, height: 4 } });
    expect(atBaseSize(a, 1)).toBe(a);
  });

  it("divides the box, every obstacle and the nudge, and leaves the input alone", () => {
    const a = ann({
      bounding_box: { x: 100, y: 200, width: 60, height: 40 },
      obstacles: [{ x: 10, y: 20, width: 30, height: 40 }],
      nudge: { x: 8, y: -4 },
    });
    const base = atBaseSize(a, 2);
    expect(base.bounding_box).toEqual({ x: 50, y: 100, width: 30, height: 20 });
    expect(base.obstacles).toEqual([{ x: 5, y: 10, width: 15, height: 20 }]);
    expect(base.nudge).toEqual({ x: 4, y: -2 });
    expect(base.copy).toBe("Click Play");
    expect(a.bounding_box!.x).toBe(100);
    expect(a.obstacles![0]!.width).toBe(30);
  });

  it("adds no key the record did not have", () => {
    expect(Object.keys(atBaseSize(ann(), 2)).sort()).toEqual(["copy", "selector", "step"]);
  });

  it("keeps an empty obstacle list empty and multiplies at a factor under 1", () => {
    const base = atBaseSize(
      ann({ obstacles: [], bounding_box: { x: 5, y: 5, width: 10, height: 10 } }),
      0.5,
    );
    expect(base.obstacles).toEqual([]);
    expect(base.bounding_box).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });
});

describe("layoutAtScale", () => {
  const layout = (over: Partial<CalloutLayout> = {}): CalloutLayout => ({
    lines: ["Click Play"],
    size: { width: 100, height: 40 },
    mode: "outside",
    side: "top",
    callout: { x: 10, y: 20 },
    arrow: { x: 30, y: 60 },
    stem: { x: 28, y: 50, width: 4, height: 10 },
    arrowLength: 8,
    nudge: { x: 2, y: -2 },
    obstacleOverlap: 10,
    otherOverlap: 3,
    ...over,
  });

  it("is the same layout at factor 1", () => {
    const l = layout();
    expect(layoutAtScale(l, 1)).toBe(l);
  });

  it("multiplies sizes and positions, and the overlaps by the factor squared", () => {
    const l = layout();
    expect(layoutAtScale(l, 2)).toMatchObject({
      lines: ["Click Play"],
      side: "top",
      size: { width: 200, height: 80 },
      callout: { x: 20, y: 40 },
      arrow: { x: 60, y: 120 },
      stem: { x: 56, y: 100, width: 8, height: 20 },
      nudge: { x: 4, y: -4 },
      arrowLength: 16,
      obstacleOverlap: 40,
      otherOverlap: 12,
    });
    expect(l.size.width).toBe(100);
  });

  it("rounds an overlap that is not a whole number of px", () => {
    const scaled = layoutAtScale(layout(), 1.5);
    expect(scaled.obstacleOverlap).toBe(23);
    expect(scaled.otherOverlap).toBe(7);
  });

  it("keeps a missing arrow and stem missing (an inside callout)", () => {
    const inside = layoutAtScale(
      layout({ mode: "inside", side: null, arrow: null, stem: null }),
      4,
    );
    expect(inside).toMatchObject({ mode: "inside", side: null, arrow: null, stem: null });
  });

  it("scales a squeezed side padding and leaves the key off when there is none", () => {
    expect(layoutAtScale(layout({ paddingX: 6 }), 2).paddingX).toBe(12);
    expect("paddingX" in layoutAtScale(layout(), 2)).toBe(false);
  });
});

describe("captionScale at the edges", () => {
  const auto = { ...DEFAULT_BURN_THEME, scale: "auto" as const };

  it("is 1 for a one-pixel and a zero-width screenshot", () => {
    expect(captionScale(auto, 1)).toBe(1);
    expect(captionScale(auto, 0)).toBe(1);
  });

  it("is 1 at display_width and 1.01 a pixel past a 2400 px one", () => {
    const wide = { ...auto, displayWidth: 2400 };
    expect(captionScale(wide, 2400)).toBe(1);
    expect(captionScale(wide, 2401)).toBe(1.01);
  });
});

describe("scaledTheme", () => {
  const shadowed: BurnTheme = {
    ...DEFAULT_BURN_THEME,
    shadow: "0px 4px 12px 0px rgba(17,24,39,0.28)",
  };

  it("is the same theme at factor 1", () => {
    expect(scaledTheme(shadowed, 1)).toBe(shadowed);
  });

  it("halves the callout dimensions and the shadow lengths at 0.5", () => {
    const t = scaledTheme(shadowed, 0.5);
    expect(t).toMatchObject({
      calloutBorderWidth: 0.5,
      radius: 3.5,
      fontSize: 7,
      lineHeight: 9.5,
      paddingX: 5.5,
      paddingY: 4,
      shadow: "0px 2px 6px 0px rgba(17,24,39,0.28)",
    });
  });

  it("quadruples them at 4 and scales a negative shadow offset", () => {
    const t = scaledTheme({ ...shadowed, shadow: "-2px -3px 4px 1px #000000" }, 4);
    expect(t).toMatchObject({ calloutBorderWidth: 4, radius: 28, fontSize: 56, lineHeight: 76 });
    expect(t).toMatchObject({ paddingX: 44, paddingY: 32 });
    expect(t.shadow).toBe("-8px -12px 16px 4px #000000");
  });

  it("rounds to two decimals and keeps a null shadow null", () => {
    const t = scaledTheme(DEFAULT_BURN_THEME, 0.33);
    expect(t).toMatchObject({ fontSize: 4.62, lineHeight: 6.27, paddingX: 3.63, radius: 2.31 });
    expect(t.shadow).toBeNull();
  });

  it("leaves the colours and the settings the layout reads at base size", () => {
    const t = scaledTheme(shadowed, 2);
    expect(t.accent).toBe(shadowed.accent);
    expect([t.arrowSize, t.maxWidthRatio, t.scale, t.displayWidth]).toEqual([8, 0.62, 1, 720]);
    expect(shadowed.radius).toBe(7);
  });
});

describe("the sizing keys at their limits", () => {
  const ACCEPTED: [unknown, keyof BurnTheme, unknown][] = [
    [{ scale: 0.5 }, "scale", 0.5],
    [{ scale: 4 }, "scale", 4],
    [{ scale: "auto" }, "scale", "auto"],
    [{ scale: " 1.5 " }, "scale", 1.5],
    [{ display_width: 240 }, "displayWidth", 240],
    [{ display_width: 2400 }, "displayWidth", 2400],
    [{ max_width_ratio: 0.2 }, "maxWidthRatio", 0.2],
    [{ max_width_ratio: 1 }, "maxWidthRatio", 1],
    [{ font_weight: " 400 " }, "fontWeight", 400],
  ];

  it.each(ACCEPTED)("accepts %j", (block, prop, value) => {
    expect(themeOf(block)[prop]).toBe(value);
  });

  it.each([
    [{ scale: 0.49 }, "scale: 0.49 is outside the range 0.5 to 4"],
    [{ scale: 4.01 }, "scale: 4.01 is outside the range 0.5 to 4"],
    [{ scale: "5" }, "scale: 5 is outside the range 0.5 to 4"],
    [{ scale: "-1" }, 'scale: "-1" is not a scale'],
    [{ scale: Number.NaN }, "scale: NaN is not a scale"],
    [{ display_width: 239 }, "display_width: 239 is outside the range 240 to 2400"],
    [{ display_width: 2401 }, "display_width: 2401 is outside the range 240 to 2400"],
    [{ display_width: "720" }, 'display_width: "720" is not a number'],
    [{ max_width_ratio: 0.19 }, "max_width_ratio: 0.19 is outside the range 0.2 to 1"],
    [{ max_width_ratio: 1.01 }, "max_width_ratio: 1.01 is outside the range 0.2 to 1"],
    [{ max_width_ratio: Number.NaN }, "max_width_ratio: NaN is not a number"],
    [{ font_weight: 700 }, "font_weight: 700 is not a supported weight"],
    [{ font_weight: "bold" }, 'font_weight: "bold" is not a supported weight'],
  ])("refuses %j", (block, message) => {
    expect(problemOf(block)).toContain(message);
  });

  it("lists every bad sizing key in the order they were written", () => {
    try {
      themeOf({ scale: 0, display_width: 1, arrow_size: 99 });
      throw new Error("the block was accepted");
    } catch (e) {
      const problems = (e as BurnThemeError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.map((p) => p.split(":")[0])).toEqual([
        "scale",
        "display_width",
        "arrow_size",
      ]);
    }
  });

  it("lets a key in the block override the readable preset's sizing", () => {
    expect(themeOf({ preset: "readable" })).toMatchObject({ scale: "auto", displayWidth: 720 });
    expect(themeOf({ preset: "readable", scale: 1 }).scale).toBe(1);
    expect(themeOf({ preset: "readable", display_width: 360 })).toMatchObject({
      scale: "auto",
      displayWidth: 360,
    });
  });
});

describe("the tree at the scale limits", () => {
  const IMAGE = { width: 800, height: 600, dataUri: "data:image/png;base64,AAAA" };
  const box = { x: 360, y: 280, width: 80, height: 40 };
  const overlay = (tree: BurnNode): BurnNode[] => (tree.props.children as BurnNode[]).slice(1);
  const styleOf = (n: BurnNode) => n.props.style!;
  const tree = (theme?: BurnTheme) =>
    buildBurnTree({
      image: IMAGE,
      annotations: [ann({ bounding_box: box })],
      metrics: METRICS,
      ...(theme ? { theme } : {}),
    });
  const calloutOf = (t: BurnNode) => overlay(t).find((n) => styleOf(n).backgroundColor === "#fff")!;
  const haloOf = (t: BurnNode) =>
    overlay(t).find((n) => String(styleOf(n).border ?? "").includes("#e8590c"))!;

  it("halves the callout, its text and the halo outline at scale 0.5", () => {
    const plain = tree();
    const half = tree(themeOf({ scale: 0.5 }));
    expect(styleOf(calloutOf(half)).width).toBe((styleOf(calloutOf(plain)).width as number) / 2);
    expect(styleOf(calloutOf(half)).fontSize).toBe(7);
    expect(styleOf(haloOf(half)).border).toBe("1px solid #e8590c");
  });

  it("draws only the screenshot and reports nothing for an empty annotation list", () => {
    const report: AnnotationReport[] = [];
    const empty = buildBurnTree({
      image: IMAGE,
      annotations: [],
      metrics: METRICS,
      theme: themeOf({ preset: "readable" }),
      report,
    });
    expect(empty.props.children).toHaveLength(1);
    expect(report).toEqual([]);
  });
});

describe("a one-pixel screenshot, rendered", () => {
  const annotation = ann({ bounding_box: { x: 0, y: 0, width: 1, height: 1 }, index: 1 });

  it("comes back as a one-pixel PNG with one report entry", async () => {
    const { png, report } = await renderBurn({
      screenshotBuffer: solidPng(1, 1),
      annotations: [annotation],
    });
    expect(pngDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(report).toHaveLength(1);
    expect(report[0]!.mode).toBe("outside");
  });

  it("does the same at scale 4", async () => {
    const { png } = await renderBurn({
      screenshotBuffer: solidPng(1, 1),
      annotations: [annotation],
      options: { theme: { ...DEFAULT_BURN_THEME, scale: 4 } },
    });
    expect(pngDimensions(png)).toEqual({ width: 1, height: 1 });
  });
});
