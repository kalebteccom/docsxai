// The `annotations.json` of a flow as `docsxai-viewer burn` reads it: a damaged file stops the
// burn with an error that names the file and the first problem. (`build` and `site` render what
// they can and say what was left out, see `parseAnnotations`.) Leaf module.

import type { AnnotationRecord } from "./annotations.js";

/** An `annotations.json` that cannot be burned; `file` is the one to fix. */
export class AnnotationsFileError extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
    this.name = "AnnotationsFileError";
  }
}

/** The records of an `annotations.json` text, or an {@link AnnotationsFileError} that names the file and the first problem. */
export function readAnnotationList(raw: string, file: string): AnnotationRecord[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new AnnotationsFileError(file, `not valid JSON: ${(e as Error).message}`);
  }
  const list = (doc as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(list)) {
    throw new AnnotationsFileError(file, 'expected an "annotations" list');
  }
  list.forEach((a: unknown, i) => {
    const step = (a as { step?: unknown } | null)?.step;
    if (typeof step !== "string" || step === "") {
      throw new AnnotationsFileError(file, `annotations[${i}] has no "step"`);
    }
  });
  return list as AnnotationRecord[];
}

/**
 * The `device_scale_factor` of an `annotations.json` text (device pixels per CSS pixel the engine
 * captured at), or `undefined` when the file has none, which means 1. A value that is not a number
 * from 1 to 4 is an {@link AnnotationsFileError}. Expects text that {@link readAnnotationList} accepted.
 */
export function readDeviceScaleFactor(raw: string, file: string): number | undefined {
  const value = (JSON.parse(raw) as { device_scale_factor?: unknown } | null)?.device_scale_factor;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 4) {
    throw new AnnotationsFileError(
      file,
      `"device_scale_factor" must be a number from 1 to 4 (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}
