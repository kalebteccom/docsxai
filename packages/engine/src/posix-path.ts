// Workspace-relative paths in reports, halt hints and jargon hits are written with `/` on every
// platform; `path.relative` joins with a backslash on Windows.

import * as path from "node:path";

/** `p` with `sep` (the platform separator by default) replaced by `/`. */
export function toPosix(p: string, sep: string = path.sep): string {
  return sep === "/" ? p : p.split(sep).join("/");
}
