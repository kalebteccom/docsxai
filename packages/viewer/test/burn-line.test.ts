// The thin-line connector of themed burns: where it starts and ends, how long it may get, what
// colour it takes over the screenshot, and that the default themed burn draws no triangle.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, renderBurn, type BurnNode } from "../src/burn.js";
import { DEFAULT_BURN_THEME, type BurnTheme } from "../src/burn-theme.js";
import {
  LINE_GAP,
  LINE_MAX_DISTANCE,
  captionRect,
  drawnStyle,
  lineColor,
  linePath,
  lineSvg,
  pathLength,
} from "../src/burn-line.js";
import { layoutCallout, type CalloutLayout } from "../src/burn-callout.js";
import { planCallout } from "../src/obstacle-placement.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import type { Side } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import { solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const IMAGE = { width: 800, height: 600, dataUri: "data:image/png;base64,AAAA" };
const TARGET = { x: 360, y: 280, width: 80, height: 30 };
const THEMED: BurnTheme = { ...DEFAULT_BURN_THEME, calloutBorderColor: "#5c00b8" };

const ann = (over: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  step: "s",
  selector: "#t",
  bounding_box: TARGET,
  copy: "Opens the ledger for this cycle",
  index: 1,
  ...over,
});

/** A laid-out callout of 120 x 40 on `side` of the target, `distance` px away. */
function layoutOn(side: Side, distance: number, slide = 0): CalloutLayout {
  const size = { width: 120, height: 40 };
  const t = TARGET;
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  const at: Record<Side, { callout: { x: number; y: number }; arrow: { x: number; y: number } }> = {
    top: {
      callout: { x: cx - 60 + slide, y: t.y - distance - 40 },
      arrow: { x: cx, y: t.y },
    },
    bottom: {
      callout: { x: cx - 60 + slide, y: t.y + t.height + distance },
      arrow: { x: cx, y: t.y + t.height },
    },
    left: {
      callout: { x: t.x - distance - 120, y: cy - 20 + slide },
      arrow: { x: t.x, y: cy },
    },
    right: {
      callout: { x: t.x + t.width + distance, y: cy - 20 + slide },
      arrow: { x: t.x + t.width, y: cy },
    },
  };
  return {
    lines: ["x"],
    size,
    mode: "outside",
    side,
    ...at[side],
    stem: null,
    arrowLength: 8,
    nudge: { x: 0, y: 0 },
    obstacleOverlap: 0,
    otherOverlap: 0,
  };
}

/** True when `p` lies on the rect's boundary (within a hundredth of a px). */
function onEdge(
  p: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
) {
  const e = 0.01;
  const inX = p.x >= r.x - e && p.x <= r.x + r.width + e;
  const inY = p.y >= r.y - e && p.y <= r.y + r.height + e;
  const onV = Math.abs(p.x - r.x) < e || Math.abs(p.x - (r.x + r.width)) < e;
  const onH = Math.abs(p.y - r.y) < e || Math.abs(p.y - (r.y + r.height)) < e;
  return (onV && inY) || (onH && inX);
}

const SIDES: Side[] = ["top", "bottom", "left", "right"];

describe("linePath", () => {
  it.each(SIDES)(
    "starts on the caption edge facing the target and ends on the target (%s)",
    (side) => {
      const l = layoutOn(side, LINE_GAP);
      const p = linePath(l, 10)!;
      const c = captionRect(l);
      expect(onEdge(p.start, c)).toBe(true);
      expect(onEdge(p.end, TARGET)).toBe(true);
      expect(p.end).toEqual(l.arrow);
      // The edge that faces the target: no gap, and the path does not run back over the caption.
      expect(pathLength(p)).toBeCloseTo(LINE_GAP, 5);
      expect(p.points).toHaveLength(2);
    },
  );

  it("takes one elbow when the target is off the caption's span, and keeps the start off its corners", () => {
    const l = layoutOn("top", 30, 140);
    const p = linePath(l, 10)!;
    const c = captionRect(l);
    expect(onEdge(p.start, c)).toBe(true);
    expect(p.start.x).toBe(c.x + 10);
    expect(p.points).toHaveLength(4);
    expect(p.points[1]!.x).toBe(p.start.x);
    expect(p.points[2]!.x).toBe(p.end.x);
  });

  it("applies the nudge to both ends", () => {
    const l = { ...layoutOn("bottom", LINE_GAP), nudge: { x: 5, y: 7 } };
    const p = linePath(l, 10)!;
    expect(onEdge(p.start, captionRect(l))).toBe(true);
    expect(p.end).toEqual({ x: l.arrow!.x + 5, y: l.arrow!.y + 7 });
  });

  it("is null for a callout inside its target", () => {
    expect(linePath({ ...layoutOn("top", 10), side: null, arrow: null }, 10)).toBeNull();
  });
});

describe("lineSvg", () => {
  const look = { color: "#5c00b8", stroke: 2, end: "dot" as const, dotRadius: 3, chevronArm: 5 };

  it("draws one stroked path and a dot, with no filled triangle", () => {
    const { svg } = lineSvg(linePath(layoutOn("top", LINE_GAP), 10)!, look);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill="none" stroke="#5c00b8" stroke-width="2"');
    expect(svg).toContain('<circle cx="');
    expect(svg).not.toMatch(/polygon|Z"/);
  });

  it("ends in an open chevron for the chevron style", () => {
    const { svg } = lineSvg(linePath(layoutOn("left", LINE_GAP), 10)!, { ...look, end: "chevron" });
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).not.toContain("<circle");
    expect(svg).not.toMatch(/fill="#/);
  });

  it("is the same text for the same layout", () => {
    const a = lineSvg(linePath(layoutOn("right", 30, 9), 10)!, look);
    const b = lineSvg(linePath(layoutOn("right", 30, 9), 10)!, look);
    expect(a).toEqual(b);
  });

  it("places the path's start at the caption edge in screenshot px", () => {
    const l = layoutOn("top", LINE_GAP);
    const p = linePath(l, 10)!;
    const s = lineSvg(p, look);
    const m = /d="M([\d.]+) ([\d.]+)/.exec(s.svg)!;
    expect(s.left + Number(m[1])).toBeCloseTo(p.start.x, 2);
    expect(s.top + Number(m[2])).toBeCloseTo(captionRect(l).y + 40, 2);
  });
});

describe("line length", () => {
  // Content above, below and beside the target, so the planner wants to move the callout far out.
  const crowd = [
    { x: 0, y: 160, width: 800, height: 110 },
    { x: 0, y: 320, width: 800, height: 120 },
    { x: 0, y: 270, width: 350, height: 50 },
    { x: 450, y: 270, width: 350, height: 50 },
  ];

  it("never detaches the callout past maxDistance", () => {
    const base = {
      image: { width: 800, height: 600 },
      target: TARGET,
      callout: { width: 200, height: 40 },
      obstacles: crowd,
      gap: LINE_GAP,
    };
    expect(planCallout(base).distance).toBeGreaterThan(LINE_MAX_DISTANCE);
    expect(planCallout({ ...base, maxDistance: LINE_MAX_DISTANCE }).distance).toBeLessThanOrEqual(
      LINE_MAX_DISTANCE,
    );
  });

  it("keeps a themed burn's drawn line within the cap", () => {
    const layout = layoutCallout({
      ann: ann({ obstacles: crowd }),
      target: TARGET,
      image: IMAGE,
      metrics: METRICS,
      clear: [],
      gap: LINE_GAP,
      maxDistance: LINE_MAX_DISTANCE,
    });
    expect(pathLength(linePath(layout, 10)!)).toBeLessThanOrEqual(LINE_MAX_DISTANCE);
  });
});

describe("the connector a burn draws", () => {
  const children = (tree: BurnNode) => tree.props.children as BurnNode[];
  const triangles = (tree: BurnNode) => children(tree).filter((n) => n.props.style?.clipPath);
  const lines = (tree: BurnNode) =>
    children(tree).filter(
      (n) => n.type === "img" && String(n.props.src).startsWith("data:image/svg"),
    );
  const tree = (theme?: BurnTheme) =>
    buildBurnTree({
      image: IMAGE,
      annotations: [ann()],
      metrics: METRICS,
      ...(theme ? { theme } : {}),
    });

  it("is a line, not a triangle, for a themed burn by default", () => {
    expect(triangles(tree(THEMED))).toHaveLength(0);
    expect(lines(tree(THEMED))).toHaveLength(1);
  });

  it("is the triangle without a theme, and with connector_style arrow", () => {
    expect(triangles(tree())).toHaveLength(1);
    expect(lines(tree())).toHaveLength(0);
    expect(triangles(tree({ ...THEMED, connectorStyle: "arrow" }))).toHaveLength(1);
  });

  it("scales its stroke with the caption", () => {
    const svgOf = (theme: BurnTheme) =>
      Buffer.from(String(lines(tree(theme))[0]!.props.src).split(",")[1]!, "base64").toString();
    expect(svgOf(THEMED)).toContain('stroke-width="2"');
    expect(svgOf({ ...THEMED, scale: 2 })).toContain('stroke-width="4"');
  });

  it("renders the same bytes twice", async () => {
    const run = () =>
      renderBurn({
        screenshotBuffer: solidPng(800, 600),
        annotations: [ann()],
        options: { theme: THEMED },
      });
    expect((await run()).png.equals((await run()).png)).toBe(true);
  });
});

describe("line colour", () => {
  it("keeps the callout outline colour where it contrasts with the pixels", () => {
    expect(lineColor(THEMED, "#ffffff")).toBe("#5c00b8");
    expect(lineColor(THEMED, null)).toBe("#5c00b8");
  });

  it("takes the callout's text or fill colour where the outline would be lost", () => {
    const dark: BurnTheme = {
      ...DEFAULT_BURN_THEME,
      calloutBackground: "#151b20",
      ink: "#f1f0e4",
      calloutBorderColor: "#1c1c1c",
    };
    expect(lineColor(dark, "#08090a")).toBe("#f1f0e4");
  });
});

describe("connector_style", () => {
  const resolve = (block: unknown) =>
    resolveBurnTheme(parseThemeConfig(block), { workspace: "/tmp/docsxai-theme-workspace" });

  it("defaults to auto: the triangle without a theme, the line with one", () => {
    expect(resolve({}).connectorStyle).toBe("auto");
    expect(drawnStyle("auto", false)).toBe("arrow");
    expect(drawnStyle("auto", true)).toBe("line");
    expect(drawnStyle("chevron", false)).toBe("chevron");
  });

  it("accepts the four styles and refuses others", () => {
    expect(resolve({ connector_style: "chevron" }).connectorStyle).toBe("chevron");
    expect(() => resolve({ connector_style: "curve" })).toThrow(/connector_style/);
  });
});
