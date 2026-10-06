// Annotations as `docsxai pack` reads them. Two inputs end in the same two things: the records the
// burner draws (`AnnotationRecord`) and the callouts the manifest lists (`PackCallout`).
//   - raw capture sidecars carry `{ index, copy, bbox, arrow_style?, nudge?, obstacles?, placement? }`
//   - a workspace's `annotations.json` already holds records (the engine wrote them)

import type {
  AnnotationPlacement,
  AnnotationRecord,
  BoundingBox,
  NudgeOffset,
} from "./annotations.js";
import type { PackCallout } from "./pack-schema.js";

const MAX_OBSTACLES = 40;
const SIDES = ["top", "bottom", "left", "right"];
const ALIGNS = ["start", "center", "end"];
const ARROW_STYLE = /^(?:top|bottom|left|right)(?:-[a-z]+)?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readBox(value: unknown, where: string): BoundingBox {
  if (!isObj(value) || !["x", "y", "width", "height"].every((k) => finite(value[k]))) {
    throw new Error(`${where} needs numeric x, y, width and height`);
  }
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
  };
}

function readNudge(value: unknown, where: string): NudgeOffset {
  if (!isObj(value) || !finite(value.x) || !finite(value.y)) {
    throw new Error(`${where}: nudge needs numeric x and y`);
  }
  return { x: value.x, y: value.y };
}

function readPlacement(value: unknown, where: string): AnnotationPlacement {
  if (!isObj(value)) throw new Error(`${where}: placement must be an object`);
  const out: AnnotationPlacement = {};
  if (value.inside !== undefined) {
    if (typeof value.inside !== "boolean")
      throw new Error(`${where}: placement.inside must be a boolean`);
    out.inside = value.inside;
  }
  if (value.pin_arrow !== undefined) {
    if (typeof value.pin_arrow !== "boolean")
      throw new Error(`${where}: placement.pin_arrow must be a boolean`);
    out.pin_arrow = value.pin_arrow;
  }
  if (value.side !== undefined) {
    if (typeof value.side !== "string" || !SIDES.includes(value.side)) {
      throw new Error(`${where}: placement.side must be one of ${SIDES.join(", ")}`);
    }
    out.side = value.side as NonNullable<AnnotationPlacement["side"]>;
  }
  if (value.align !== undefined) {
    if (typeof value.align !== "string" || !ALIGNS.includes(value.align)) {
      throw new Error(`${where}: placement.align must be one of ${ALIGNS.join(", ")}`);
    }
    out.align = value.align as NonNullable<AnnotationPlacement["align"]>;
  }
  if (value.max_width !== undefined) {
    if (!finite(value.max_width) || value.max_width < 120 || value.max_width > 560) {
      throw new Error(`${where}: placement.max_width must be 120 to 560`);
    }
    out.max_width = value.max_width;
  }
  return out;
}

/** One sidecar annotation → burner record. `withIndex`: number the badge (steps with 2+ annotations). */
function toRecord(step: string, raw: unknown, withIndex: boolean, where: string): AnnotationRecord {
  if (!isObj(raw)) throw new Error(`${where}: annotation must be an object`);
  if (!Number.isInteger(raw.index) || (raw.index as number) < 1) {
    throw new Error(`${where}: index must be a positive integer`);
  }
  if (typeof raw.copy !== "string" || raw.copy.trim() === "") {
    throw new Error(`${where}: copy must be a non-empty string`);
  }
  const index = raw.index as number;
  const record: AnnotationRecord = {
    step,
    selector: `annotation-${index}`,
    copy: raw.copy,
    bounding_box: readBox(raw.bbox, `${where}: bbox`),
  };
  if (withIndex) record.index = index;
  if (raw.arrow_style !== undefined) {
    if (typeof raw.arrow_style !== "string" || !ARROW_STYLE.test(raw.arrow_style)) {
      throw new Error(`${where}: arrow_style must be top, bottom, left or right`);
    }
    record.arrow_style = raw.arrow_style;
  }
  if (raw.nudge !== undefined) record.nudge = readNudge(raw.nudge, where);
  if (raw.obstacles !== undefined) {
    if (!Array.isArray(raw.obstacles) || raw.obstacles.length > MAX_OBSTACLES) {
      throw new Error(`${where}: obstacles must be an array of at most ${MAX_OBSTACLES} boxes`);
    }
    record.obstacles = raw.obstacles.map((o: unknown) => readBox(o, `${where}: obstacle`));
  }
  if (raw.placement !== undefined) record.placement = readPlacement(raw.placement, where);
  return record;
}

/** A raw sidecar's `annotations` array → burner records, in file order. */
export function recordsFromSidecar(step: string, value: unknown, file: string): AnnotationRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${file}: annotations must be an array`);
  return value.map((a: unknown, i) =>
    toRecord(step, a, value.length > 1, `${file}: annotation ${i}`),
  );
}

/**
 * Callouts for the manifest: the records a reader sees drawn, that is a callout text and a halo
 * box. The badge number is the record's own `index`, else its place in the list.
 */
export function calloutsOf(records: AnnotationRecord[]): PackCallout[] {
  const drawn = records.filter(
    (r) => typeof r.copy === "string" && r.copy.trim() !== "" && isObj(r.bounding_box),
  );
  return drawn
    .map((r, i): PackCallout => {
      const box = r.bounding_box!;
      return {
        index: r.index ?? i + 1,
        copy: r.copy,
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    })
    .sort((a, b) => a.index - b.index);
}
