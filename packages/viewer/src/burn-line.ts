// The thin-line connector for burned callouts (`connector_style` `line` or `chevron`): one path
// from the caption edge nearest the target to the target's edge, ending in a small dot or an open
// chevron. Drawn as one SVG image, in a colour taken from the callout and checked for contrast
// against the screenshot under it. Pure: geometry and SVG text are functions of the layout.

import type { Rect, Side } from "./placement.js";
import type { CalloutLayout } from "./burn-callout.js";
import type { BurnNode } from "./burn.js";
import type { BurnTheme, ConnectorStyle } from "./burn-theme.js";
import { connectorColor } from "./burn-theme.js";
import { contrastRatio } from "./color.js";
import { averageHex, type PixelGrid } from "./connector-contrast.js";
import { RING_OUTSET } from "./burn-clean.js";

/** Line width at caption scale 1, px. */
export const LINE_STROKE = 2;
/** Gap between target and caption at rest, base px. The halo ring takes the first 5 px of it. */
export const LINE_GAP = 20;
/**
 * Longest gap the planner moves a line-joined caption out to while looking for empty space, base
 * px. Beyond it only the docking bands at the image's top and bottom are tried.
 */
export const LINE_MAX_DISTANCE = 176;
/** End dot radius, base px. */
export const LINE_DOT_RADIUS = 2;
/** Chevron arm length, base px. */
export const LINE_CHEVRON_ARM = 5;
/** WCAG non-text contrast a line needs against the pixels under it before another colour is tried. */
export const LINE_MIN_CONTRAST = 3;

export type DrawnStyle = Exclude<ConnectorStyle, "auto">;

/** The style a burn draws: `auto` is the triangle without a theme and the line with one. */
export function drawnStyle(style: ConnectorStyle, themed: boolean): DrawnStyle {
  if (style !== "auto") return style;
  return themed ? "line" : "arrow";
}

type Pt = { x: number; y: number };

export interface LinePath {
  side: Side;
  /** On the caption rect's edge facing the target. */
  start: Pt;
  /** The layout's arrow tip on the target's edge, moved `endOffset` px out towards the caption. */
  end: Pt;
  /** Start, any elbow corners, end. */
  points: Pt[];
}

const clamp = (v: number, lo: number, hi: number) =>
  lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));

/** The caption rect a layout draws, nudge applied. */
export function captionRect(l: CalloutLayout): Rect {
  return { x: l.callout.x + l.nudge.x, y: l.callout.y + l.nudge.y, ...l.size };
}

/**
 * Path from the caption edge nearest the target to the arrow tip, nudge applied. The start keeps
 * `inset` px from the caption's corners so it never lands on a rounded corner. Straight when the
 * tip faces the caption, else one elbow halfway. `endOffset` stops the line that far short of the
 * target edge, on the outside of a halo ring drawn around it. `null` inside the target.
 */
export function linePath(l: CalloutLayout, inset: number, endOffset = 0): LinePath | null {
  if (!l.side || !l.arrow) return null;
  const c = captionRect(l);
  const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[l.side];
  const end = {
    x: l.arrow.x + l.nudge.x + out[0]! * endOffset,
    y: l.arrow.y + l.nudge.y + out[1]! * endOffset,
  };
  const vertical = l.side === "top" || l.side === "bottom";
  let start: Pt;
  if (vertical) {
    const y = l.side === "top" ? c.y + c.height : c.y;
    start = { x: clamp(end.x, c.x + inset, c.x + c.width - inset), y };
  } else {
    const x = l.side === "left" ? c.x + c.width : c.x;
    start = { x, y: clamp(end.y, c.y + inset, c.y + c.height - inset) };
  }
  const across = vertical ? Math.abs(start.x - end.x) : Math.abs(start.y - end.y);
  if (across < 0.5) return { side: l.side, start, end, points: [start, end] };
  const points = vertical
    ? [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
    : [
        start,
        { x: (start.x + end.x) / 2, y: start.y },
        { x: (start.x + end.x) / 2, y: end.y },
        end,
      ];
  return { side: l.side, start, end, points };
}

/** Length of the path in px. */
export function pathLength(p: LinePath): number {
  let n = 0;
  for (let i = 1; i < p.points.length; i++) {
    n += Math.hypot(p.points[i]!.x - p.points[i - 1]!.x, p.points[i]!.y - p.points[i - 1]!.y);
  }
  return n;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface LineSvg {
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
}

export interface LineLook {
  color: string;
  stroke: number;
  end: "dot" | "chevron";
  dotRadius: number;
  chevronArm: number;
}

/** The path as a standalone SVG positioned at (`left`, `top`) in screenshot px. */
export function lineSvg(p: LinePath, look: LineLook): LineSvg {
  const pad = Math.max(look.dotRadius, look.chevronArm, look.stroke) + 1;
  const xs = p.points.map((q) => q.x);
  const ys = p.points.map((q) => q.y);
  const left = Math.floor(Math.min(...xs) - pad);
  const top = Math.floor(Math.min(...ys) - pad);
  const width = Math.ceil(Math.max(...xs) + pad) - left;
  const height = Math.ceil(Math.max(...ys) + pad) - top;
  const at = (q: Pt) => `${r2(q.x - left)} ${r2(q.y - top)}`;
  const d = p.points.map((q, i) => `${i === 0 ? "M" : "L"}${at(q)}`).join(" ");
  const stroke = `stroke="${look.color}" stroke-width="${r2(look.stroke)}"`;
  let marker: string;
  if (look.end === "dot") {
    marker = `<circle cx="${r2(p.end.x - left)}" cy="${r2(p.end.y - top)}" r="${r2(look.dotRadius)}" fill="${look.color}"/>`;
  } else {
    const prev = p.points[p.points.length - 2]!;
    const len = Math.hypot(p.end.x - prev.x, p.end.y - prev.y) || 1;
    const u = { x: (p.end.x - prev.x) / len, y: (p.end.y - prev.y) / len };
    const a = look.chevronArm;
    const wing = (s: number) => ({
      x: p.end.x - u.x * a - s * u.y * a * 0.8,
      y: p.end.y - u.y * a + s * u.x * a * 0.8,
    });
    marker = `<path d="M${at(wing(1))} L${at(p.end)} L${at(wing(-1))}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<path d="${d}" fill="none" ${stroke} stroke-linecap="butt" stroke-linejoin="round"/>` +
    marker +
    `</svg>`;
  return { left, top, width, height, svg };
}

/** Boxes the path's segments cover, `margin` px either side, for sampling the pixels under it. */
export function pathBoxes(p: LinePath, margin: number): Rect[] {
  const boxes: Rect[] = [];
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1]!;
    const b = p.points[i]!;
    const x = Math.min(a.x, b.x) - margin;
    const y = Math.min(a.y, b.y) - margin;
    boxes.push({
      x,
      y,
      width: Math.abs(a.x - b.x) + 2 * margin,
      height: Math.abs(a.y - b.y) + 2 * margin,
    });
  }
  return boxes;
}

/**
 * The line colour: the callout's connector colour (its outline, or text without one) when it
 * reaches {@link LINE_MIN_CONTRAST} against the average colour under the path. Otherwise the one of
 * that colour, the callout text and the callout fill with the most contrast there.
 */
export function lineColor(theme: BurnTheme, background: string | null): string {
  const primary = connectorColor(theme);
  if (background === null || contrastRatio(primary, background) >= LINE_MIN_CONTRAST) {
    return primary;
  }
  let best = primary;
  for (const c of [theme.ink, theme.calloutBackground]) {
    if (contrastRatio(c, background) > contrastRatio(best, background)) best = c;
  }
  return best;
}

/** The line connector's node for a laid-out callout in screenshot px; `f` is the caption scale. */
export function lineNodes(
  layout: CalloutLayout,
  theme: BurnTheme,
  f: number,
  style: "line" | "chevron",
  pixels?: PixelGrid,
): BurnNode[] {
  const stroke = LINE_STROKE * f;
  const path = linePath(layout, theme.radius + stroke, RING_OUTSET * f);
  if (!path) return [];
  const background = pixels ? averageHex(pixels, pathBoxes(path, stroke)) : null;
  const drawn = lineSvg(path, {
    color: lineColor(theme, background),
    stroke,
    end: style === "line" ? "dot" : "chevron",
    dotRadius: LINE_DOT_RADIUS * f,
    chevronArm: LINE_CHEVRON_ARM * f,
  });
  return [
    {
      type: "img",
      props: {
        src: `data:image/svg+xml;base64,${Buffer.from(drawn.svg).toString("base64")}`,
        width: drawn.width,
        height: drawn.height,
        style: { position: "absolute", left: drawn.left, top: drawn.top },
      },
    },
  ];
}
