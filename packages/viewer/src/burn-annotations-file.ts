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
