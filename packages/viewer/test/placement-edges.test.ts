// Edges of the placement priorities: how far side padding squeezes for other paddings, the drawn
// padding at scale, which arrow_style values count as a hint, badges on tiny and crowded images,
// and the width ladder fed odd max_width and max_width_ratio values.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { planBadge } from "../src/badge-placement.js";
import { buildBurnTree, type BurnNode } from "../src/burn.js";
import {
  DEFAULT_CALLOUT_STYLE,
  layoutCallout,
  measureCallout,
  widthLadder,
  type CalloutStyle,
} from "../src/burn-callout.js";
import { DEFAULT_BURN_THEME } from "../src/burn-theme.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import type { Rect } from "../src/placement.js";

const METRICS = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);

describe("squeezing the side padding", () => {
  const image = { width: 390, height: 780 };
  const target: Rect = { x: 20, y: 400, width: 44, height: 44 };
  const text = "Attach a file";
  const styleOf = (paddingX: number): CalloutStyle => ({ ...DEFAULT_CALLOUT_STYLE, paddingX });

  /** A corridor to the right of the target that the full-width box overruns by `overrun` px. */
  function scene(paddingX: number, overrun: number, k = 1) {
    const natural = measureCallout(text, METRICS, 242, styleOf(paddingX)).size.width;
    const x = target.x + target.width + 10 + natural - overrun;
    const obstacles: Rect[] = [
      { x, y: 0, width: image.width - x, height: image.height },
      { x: 0, y: 0, width: image.width, height: 395 },
      { x: 0, y: 449, width: image.width, height: 331 },
    ];
    const scaled = (r: Rect): Rect => ({
      x: r.x * k,
      y: r.y * k,
      width: r.width * k,
      height: r.height * k,
    });
    const ann: AnnotationRecord = {
      step: "s",
      selector: "#x",
      copy: text,
      bounding_box: scaled(target),
      obstacles: obstacles.map(scaled),
    };
    return { natural, ann };
  }
  const lay = (paddingX: number, overrun: number) => {
    const { ann } = scene(paddingX, overrun);
    return layoutCallout({
      ann,
      target,
      image,
      metrics: METRICS,
      clear: [],
      style: styleOf(paddingX),
    });
  };

  it("cuts 6 px a side from 20 and stops at 8 from 14", () => {
    expect(lay(20, 5).paddingX).toBe(14);
    expect(lay(14, 5).paddingX).toBe(8);
  });

  it("does not retry a box whose padding is already 8 or less", () => {
    const eight = lay(8, 5);
    expect(eight.paddingX).toBeUndefined();
    expect(eight.obstacleOverlap).toBeGreaterThan(0);
    expect(lay(4, 5).paddingX).toBeUndefined();
  });

  it("gives up when the gap is deeper than the squeeze saves", () => {
    expect(lay(14, 20).paddingX).toBeUndefined();
    expect(lay(20, 20).paddingX).toBeUndefined();
  });

  describe("in the drawn tree", () => {
    const IMAGE = { dataUri: "data:image/png;base64,AAAA" };
    const paddingOf = (theme: typeof DEFAULT_BURN_THEME, k: number, overrun: number) => {
      const { ann } = scene(DEFAULT_BURN_THEME.paddingX, overrun, k);
      const tree = buildBurnTree({
        image: { width: image.width * k, height: image.height * k, ...IMAGE },
        annotations: [ann],
        metrics: METRICS,
        // The scene is sized for the triangle's 10 px gap.
        theme: { ...theme, connectorStyle: "arrow" },
      });
      const callout = (tree.props.children as BurnNode[]).find(
        (n) => n.props.style?.backgroundColor === "#fff",
      )!;
      return callout.props.style!;
    };

    it("draws a squeezed box with its 8 px, and an unsqueezed one with the theme's 11", () => {
      expect(paddingOf(DEFAULT_BURN_THEME, 1, 3)).toMatchObject({
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 8,
      });
      expect(paddingOf(DEFAULT_BURN_THEME, 1, -40)).toMatchObject({
        paddingLeft: 11,
        paddingRight: 11,
      });
    });

    it("multiplies the squeezed padding by the caption scale", () => {
      const twice = { ...DEFAULT_BURN_THEME, scale: 2 };
      expect(paddingOf(twice, 2, 3)).toMatchObject({
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
      });
      expect(paddingOf(twice, 2, -40)).toMatchObject({ paddingLeft: 22, paddingRight: 22 });
    });
  });
});

describe("which arrow_style values hint a side", () => {
  const image = { width: 390, height: 780 };
  const target: Rect = { x: 20, y: 400, width: 350, height: 44 };
  // 3 px of a callout below sit in the wall, 1 px of one above
  const obstacles: Rect[] = [
    { x: 0, y: 488, width: 390, height: 292 },
    { x: 0, y: 0, width: 390, height: 354 },
  ];
  const sideOf = (over: Partial<AnnotationRecord>) =>
    layoutCallout({
      ann: { step: "s", selector: "#x", copy: "Hi", bounding_box: target, obstacles, ...over },
      target,
      image,
      metrics: METRICS,
      clear: [],
    }).side;

  it("counts a side with a suffix", () => {
    expect(sideOf({ arrow_style: "bottom-right" })).toBe("bottom");
    expect(sideOf({ arrow_style: "bottom-left" })).toBe("bottom");
  });

  it("does not count a word that is not a side", () => {
    expect(sideOf({ arrow_style: "diagonal-left" })).toBe("top");
    expect(sideOf({ arrow_style: "" })).toBe("top");
    expect(sideOf({})).toBe("top");
  });

  it("counts placement.side, which also pins the side", () => {
    expect(sideOf({ placement: { side: "bottom" } })).toBe("bottom");
  });

  it("does not count placement keys that are not a side", () => {
    expect(sideOf({ placement: { align: "start" } })).toBe("top");
    expect(sideOf({ placement: { max_width: 300 } })).toBe("top");
  });
});

describe("a badge on a small or crowded image", () => {
  const size = { width: 26, height: 26 };

  it("sits at the origin when the image is smaller than the badge", () => {
    const box = planBadge({
      image: { width: 10, height: 10 },
      target: { x: 0, y: 0, width: 10, height: 10 },
      size,
      obstacles: [],
    });
    expect(box).toEqual({ x: 0, y: 0, ...size });
  });

  it("keeps a 2 px margin on an image that is just big enough", () => {
    const box = planBadge({
      image: { width: 30, height: 30 },
      target: { x: 5, y: 5, width: 20, height: 20 },
      size,
      obstacles: [],
    });
    expect(box).toEqual({ x: 2, y: 2, ...size });
  });

  it("has no room to move in a 27 px image, so the margin gives way to 0", () => {
    const box = planBadge({
      image: { width: 27, height: 27 },
      target: { x: 5, y: 5, width: 10, height: 10 },
      size,
      obstacles: [],
    });
    expect(box).toEqual({ x: 0, y: 0, ...size });
  });

  it("keeps a 2 px margin for a target in each corner of the image", () => {
    const image = { width: 390, height: 780 };
    const corners = [
      { x: 0, y: 0 },
      { x: 350, y: 0 },
      { x: 0, y: 740 },
      { x: 350, y: 740 },
    ];
    for (const at of corners) {
      const box = planBadge({
        image,
        target: { ...at, width: 40, height: 40 },
        size,
        obstacles: [],
      });
      expect(box.x).toBeGreaterThanOrEqual(2);
      expect(box.y).toBeGreaterThanOrEqual(2);
      expect(box.x + box.width).toBeLessThanOrEqual(image.width - 2);
      expect(box.y + box.height).toBeLessThanOrEqual(image.height - 2);
    }
  });
});

describe("widthLadder with odd settings", () => {
  it("falls back to the adaptive width for a max_width that is not a finite number", () => {
    const adaptive = widthLadder(390, true);
    expect(widthLadder(390, true, { max_width: Number.NaN })).toEqual(adaptive);
    expect(widthLadder(390, true, { max_width: Number.POSITIVE_INFINITY })).toEqual(adaptive);
    expect(widthLadder(390, true, { max_width: "300" as unknown as number })).toEqual(adaptive);
  });

  it("applies the ratio without obstacles only below the default 0.62", () => {
    expect(widthLadder(1000, false, undefined, 0.2)).toEqual([200, 184, 168]);
    expect(widthLadder(400, false, undefined, 0.61)).toEqual([244, 206, 168]);
    expect(widthLadder(400, false, undefined, 0.62)).toEqual([280]);
    expect(widthLadder(400, false, undefined, 1)).toEqual([280]);
  });

  it("floors the ratio's width at 168 and caps it at 280 with obstacles", () => {
    expect(widthLadder(100, true, undefined, 1)).toEqual([168]);
    expect(widthLadder(1000, true, undefined, 1)).toEqual([280]);
    expect(widthLadder(1000, true, undefined, 0.2)).toEqual([200, 184, 168]);
  });
});
