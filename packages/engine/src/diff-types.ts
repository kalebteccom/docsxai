// Doc-pack drift report shapes — the result interfaces, severity enum, and the severity-rank
// leaf both the computation and the formatters lean on.
//
// Reports carry no timestamps: same two doc packs → byte-identical report, which is what makes
// the report PR-comment- and CI-gate-safe. These shapes are the wire contract for that report.

import type { BoundingBox } from "./doc-pack.js";

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

export type DriftSeverity = "none" | "info" | "warn" | "fail";

export const SEVERITY_RANK: Record<DriftSeverity, number> = { none: 0, info: 1, warn: 2, fail: 3 };

export function maxSeverity(a: DriftSeverity, b: DriftSeverity): DriftSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export interface DriftRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle excluded from a specific screenshot's pixel diff (a clock widget, an ad slot, …). */
export interface IgnoreRegion {
  flow: string;
  step: string;
  region: DriftRegion;
}

export interface DriftPolicy {
  /** Pixel-change percentage at/above which a screenshot diff is `warn`. Default 1. */
  screenshot_pct_warn?: number;
  /** Pixel-change percentage at/above which a screenshot diff is `fail`. Default 5. */
  screenshot_pct_fail?: number;
  /** Annotation bounding-box delta (px, max over x/y/width/height) tolerated before "moved". Default 2. */
  annotation_move_tolerance_px?: number;
  /** Regions excluded from the pixel diff of the named flow/step screenshots. */
  ignore_regions?: IgnoreRegion[];
}

export interface FieldDelta {
  field: string;
  a: unknown;
  b: unknown;
}

export interface StepChange {
  id: string;
  fields: FieldDelta[];
}

export interface AnnotationMove {
  step: string;
  copy: string;
  a: BoundingBox;
  b: BoundingBox;
  /** Max absolute delta across x / y / width / height, in image pixels. */
  delta_px: number;
}

export interface DimensionChange {
  a: { width: number; height: number };
  b: { width: number; height: number };
}

export interface ScreenshotDiff {
  step: string;
  status: "added" | "removed" | "changed";
  /** Set (instead of pixel counts) when the two PNGs have different dimensions. */
  dimension_change?: DimensionChange;
  changed_pixel_count?: number;
  /** Changed pixels as a percentage of the full image, rounded to 4 decimals. */
  pct?: number;
  /** Bounding box of all changed pixels; absent when nothing comparable changed. */
  region?: DriftRegion;
  severity: Exclude<DriftSeverity, "none">;
}

export interface ProseDiff {
  step: string;
  status: "added" | "removed" | "changed";
  lines_added: number;
  lines_removed: number;
}

export interface LocatorChange {
  name: string;
  a: string;
  b: string;
}

export interface FlowDrift {
  flow: string;
  status: "added" | "removed" | "changed";
  steps_added: string[];
  steps_removed: string[];
  steps_changed: StepChange[];
  annotations_moved: AnnotationMove[];
  screenshots: ScreenshotDiff[];
  prose: ProseDiff[];
  locators_added: string[];
  locators_removed: string[];
  locators_changed: LocatorChange[];
  severity: Exclude<DriftSeverity, "none">;
}

export interface DriftSummary {
  flows_changed: number;
  /** Steps added + removed + field-changed, across all flows. */
  steps_changed: number;
  screenshots_changed: number;
  max_pixel_change_pct: number;
  severity: DriftSeverity;
}

export interface DriftReport {
  schema: "docsxai/drift@1";
  a: string;
  b: string;
  /** Only flows with drift appear; sorted by flow name. */
  flows: FlowDrift[];
  summary: DriftSummary;
}

export class DriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftError";
  }
}

// ---------------------------------------------------------------------------
// PNG pixel diff result
// ---------------------------------------------------------------------------

export type PngDiffResult =
  | {
      kind: "dimension-change";
      a: { width: number; height: number };
      b: { width: number; height: number };
    }
  | { kind: "pixels"; changed_pixel_count: number; pct: number; region: DriftRegion | null };
