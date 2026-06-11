// Structural mirror of the engine's `site-docs/annotations@1` doc-pack schema
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

export interface AnnotationRecord {
  step: string;
  selector: string;
  bounding_box?: BoundingBox;
  copy: string;
  arrow_style?: string;
  /** Optional pixel offset applied to the callout + arrow after Popper-like placement; halo stays put. */
  nudge?: NudgeOffset;
  /** 1-based index within the step's screenshot — set only when the step has > 1 annotation. */
  index?: number;
}

export interface AnnotationsFile {
  schema: string;
  flow: string;
  annotations: AnnotationRecord[];
}
