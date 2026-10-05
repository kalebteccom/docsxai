// Structural mirror of the engine's `docsxai/annotations@1` doc-pack schema
// (packages/engine/src/doc-pack.ts). Redeclared here because the viewer must not
// depend on the engine package — the schema id is the cross-package contract,
// not a TypeScript import.

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NudgeOffset {
  x: number;
  y: number;
}

/**
 * Optional per-annotation placement settings for the burner (the interactive viewer ignores them).
 * Mirrors `AnnotationPlacement` in the engine's `doc-pack.ts`; every key is optional.
 */
export interface AnnotationPlacement {
  /** Put the callout inside the target when the target can hold it (no arrow). */
  inside?: boolean;
  /** Only try this side of the target; falls back to the usual order when nothing fits there. */
  side?: "top" | "bottom" | "left" | "right";
  /** Where along the target's edge the callout sits: flush with its start, centred, or flush with its end. */
  align?: "start" | "center" | "end";
  /** `nudge` moves only the callout; the arrow stays on the target and a stem joins the two. */
  pin_arrow?: boolean;
  /** Widest outer callout box in px, 120 to 560 (default 280, narrower on small screenshots with obstacles). */
  max_width?: number;
  /** Capture-time obstacle scan radius in CSS px. Read by `docsxai run`, not by the burner. */
  obstacle_radius?: number;
  /** Capture-time cap on recorded obstacles. Read by `docsxai run`, not by the burner. */
  obstacle_limit?: number;
}

export interface AnnotationRecord {
  step: string;
  selector: string;
  bounding_box?: BoundingBox;
  copy: string;
  arrow_style?: string;
  /** Optional pixel offset applied to the callout + arrow after Popper-like placement; halo stays put. */
  nudge?: NudgeOffset;
  /**
   * Boxes of page content (text, controls) the burner keeps this annotation's callout from covering,
   * in the screenshot's pixel space. List the neighbours only: the target is excluded, and a box that
   * contains the target cannot be avoided. Absent or empty: the callout goes next to the target as
   * before. Used by the static burner; the interactive viewer ignores it.
   */
  obstacles?: BoundingBox[];
  /** Burner placement settings (inside the target, side, alignment, pinned arrow, width). */
  placement?: AnnotationPlacement;
  /** 1-based index within the step's screenshot — set only when the step has > 1 annotation. */
  index?: number;
}

export interface AnnotationsFile {
  schema: string;
  flow: string;
  annotations: AnnotationRecord[];
}
