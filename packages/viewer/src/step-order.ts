// Which steps a flow page lists, and in what order. The annotation file sets the order of the
// steps it has records for; a screenshot with no record follows them as a plain screenshot.

import { compareNatural } from "./natural-order.js";

/**
 * `annotated` (step ids in the order their first record appears) first, then every `.png` in
 * `shotFiles` whose step has no record, in natural order (`step-2` before `step-10`). With no records that is the screenshots alone.
 */
export function orderSteps(annotated: readonly string[], shotFiles: readonly string[]): string[] {
  const seen = new Set(annotated);
  const plain = shotFiles
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .filter((id) => !seen.has(id))
    .sort(compareNatural);
  return [...seen, ...plain];
}
