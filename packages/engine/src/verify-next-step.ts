// The one-line next step the `run --verify-determinism` report prints under the first difference.
// The cause line says where two runs part ways; this line says what to pin. Text and markdown
// renderings only: the JSON report keeps its shape.

import type { ArtefactDifference } from "./verify-compare.js";

// A JSON key path that names a time, a date, a duration or an id.
const TIME_OR_ID_PATH = /time|date|(?:^|[._\]])at$|duration|elapsed|(?:^|[._\]])id$|uuid/i;

export function nextStepFor(d: ArtefactDifference): string {
  switch (d.kind) {
    case "missing":
    case "extra":
      return "A file exists in one run only. Look for a step that branches on timing or live data, then pin it.";
    case "png":
      return d.dimension_change
        ? "The image size changed. Pin the viewport and wait for web fonts to load before the step."
        : "Pixels changed in a region. Look for an animation, a caret, a relative date or a clock there, then freeze it with environment.clock or wait_for: settled, or cover it with hide.";
    case "json":
      return d.json_path !== undefined && TIME_OR_ID_PATH.test(d.json_path)
        ? "A time or id value differs. Pin environment.clock in the flow and check that no id comes from random or server state."
        : "A value differs between runs. Look for a locator or label that follows live data and point it at stable text.";
    case "text":
      return "A text artefact differs. Look for dates, counters or generated ids written into it.";
    case "bytes":
      return "Binary content differs with no structure to compare. Look for an embedded timestamp or random seed.";
  }
}
