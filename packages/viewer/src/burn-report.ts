// What `burn --report` writes: where each callout and badge landed, how much of the page they
// cover, and which annotations found no clear spot. The burner never drops an annotation; the
// pipeline reads this and decides (shorten the copy, add `placement`, drop the callout).

import type { Rect, Side } from "./placement.js";
import type { CalloutLayout } from "./burn-callout.js";
import type { AnnotationRecord } from "./annotations.js";

export const BURN_REPORT_SCHEMA = "docsxai/burn-report@1";

/**
 * An annotation is unplaceable when its best layout still covers more than this share of its own
 * callout's area (obstacles, other halos, badges and earlier callouts, plus its arrow and stem).
 * 0.1 lets a callout graze a line of text; a callout over a whole paragraph is reported.
 */
export const DEFAULT_UNPLACEABLE_RATIO = 0.1;

export interface AnnotationReport {
  step: string;
  /** The record's 1-based `index`, `null` for an un-numbered annotation. */
  index: number | null;
  selector: string;
  /** `none`: no callout was drawn (no `copy`, or no `bounding_box`). */
  mode: "outside" | "inside" | "none";
  /** Side of the target the callout sits on; `null` inside the target or with no callout. */
  side: Side | null;
  /** Callout box in screenshot px, `nudge` included. */
  callout: Rect | null;
  badge: Rect | null;
  /** Px² of callout, arrow and stem on `obstacles`. */
  obstacle_overlap: number;
  /** Px² of callout, arrow and stem on other halos, badges and earlier callouts. */
  other_overlap: number;
  /** Both overlaps as a share of the callout's area, 3 decimals. */
  overlap_ratio: number;
  /** `overlap_ratio` is above the threshold: no clear spot was found. The callout is drawn anyway. */
  unplaceable: boolean;
  /** Why nothing was drawn: `no bounding_box` or `no screenshot`. */
  skipped?: string;
}

export interface FlowBurnReport {
  flow: string;
  annotations: AnnotationReport[];
}

export interface BurnReport {
  schema: typeof BURN_REPORT_SCHEMA;
  /** The `overlap_ratio` above which an annotation is `unplaceable`. */
  threshold: number;
  flows: FlowBurnReport[];
  /** Count of `unplaceable` annotations across all flows. */
  unplaceable: number;
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};
const roundRect = (r: Rect): Rect => ({
  x: round(r.x, 2),
  y: round(r.y, 2),
  width: round(r.width, 2),
  height: round(r.height, 2),
});

const base = (ann: AnnotationRecord) => ({
  step: ann.step,
  index: typeof ann.index === "number" ? ann.index : null,
  selector: ann.selector,
});

/** Report entry for an annotation the burner could not draw: no `bounding_box`, or no screenshot. */
export function skippedReport(ann: AnnotationRecord, reason: string): AnnotationReport {
  return {
    ...base(ann),
    mode: "none",
    side: null,
    callout: null,
    badge: null,
    obstacle_overlap: 0,
    other_overlap: 0,
    overlap_ratio: 0,
    unplaceable: false,
    skipped: reason,
  };
}

/** Report entry for a drawn annotation; `layout` is `null` when it has no callout. */
export function annotationReport(
  ann: AnnotationRecord,
  layout: CalloutLayout | null,
  box: Rect | null,
  badge: Rect | undefined,
  threshold: number,
): AnnotationReport {
  const badgeBox = badge ? roundRect(badge) : null;
  if (!layout || !box) {
    return {
      ...base(ann),
      mode: "none",
      side: null,
      callout: null,
      badge: badgeBox,
      obstacle_overlap: 0,
      other_overlap: 0,
      overlap_ratio: 0,
      unplaceable: false,
    };
  }
  const ratio = (layout.obstacleOverlap + layout.otherOverlap) / (box.width * box.height);
  return {
    ...base(ann),
    mode: layout.mode,
    side: layout.side,
    callout: roundRect(box),
    badge: badgeBox,
    obstacle_overlap: layout.obstacleOverlap,
    other_overlap: layout.otherOverlap,
    overlap_ratio: round(ratio, 3),
    unplaceable: ratio > threshold,
  };
}
