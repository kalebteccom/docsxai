// Geometry of the one-elbow line connector: the line leaves the target square to one edge, turns
// once at a corner and runs straight to the caption. Pure, and a leaf so both the layout boxes
// (burn-callout.ts) and the drawn path (burn-line.ts) read the same points.

import type { Rect, Side } from "./placement.js";

type Pt = { x: number; y: number };

/** What the elbow path reads from a laid-out callout. */
export interface ElbowLayout {
  side: Side | null;
  arrow: Pt | null;
  /** The corner, before nudge. */
  elbow?: Pt;
  callout: Pt;
  size: { width: number; height: number };
  nudge: Pt;
}

/** Unit step away from the target for each side. */
export const OUTWARD: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Caption-edge start, corner and end of an elbow connector, nudge applied; `null` without an
 * elbow. The end is the arrow tip moved `endOffset` px out from the target. The start is the corner
 * carried straight to the caption edge that faces it.
 */
export function elbowPoints(l: ElbowLayout, endOffset: number): [Pt, Pt, Pt] | null {
  if (!l.side || !l.arrow || !l.elbow) return null;
  const n = l.nudge;
  const out = OUTWARD[l.side];
  const end = { x: l.arrow.x + n.x + out.x * endOffset, y: l.arrow.y + n.y + out.y * endOffset };
  const corner = { x: l.elbow.x + n.x, y: l.elbow.y + n.y };
  const c = { x: l.callout.x + n.x, y: l.callout.y + n.y };
  const firstLegVertical = l.side === "top" || l.side === "bottom";
  const start = firstLegVertical
    ? { x: c.x >= corner.x ? c.x : c.x + l.size.width, y: corner.y }
    : { x: corner.x, y: c.y >= corner.y ? c.y : c.y + l.size.height };
  return [start, corner, end];
}

/** The box an axis-aligned segment from `a` to `b` covers, `half` px either side of it. */
export function segmentRect(a: Pt, b: Pt, half: number): Rect {
  return {
    x: Math.min(a.x, b.x) - half,
    y: Math.min(a.y, b.y) - half,
    width: Math.abs(a.x - b.x) + 2 * half,
    height: Math.abs(a.y - b.y) + 2 * half,
  };
}
