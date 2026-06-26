// Doc-pack drift detection — deterministic diff between two doc-pack directories.
//
// The engine DETECTS drift and reports it; proposing flow-file patches is the host agent's
// calibration-time job (`diagnose` feeds that loop). `docsxai baseline` snapshots a doc pack;
// `docsxai diff` compares the live workspace against it and emits this module's DriftReport —
// per flow: step deltas (id-keyed field changes), annotation moves (bounding-box delta beyond a
// pixel tolerance), screenshot pixel diffs (pngjs, exact RGBA compare, ignore-region aware),
// prose line-change counts, and locator changes. Reports carry no timestamps: same two doc packs
// → byte-identical report, which is what makes the report PR-comment- and CI-gate-safe.
//
// This module is a barrel: the report shapes live in `diff-types.ts`, the deterministic
// computation in `diff-compute.ts`, the severity gate + formatters in `diff-report.ts`. Importers
// keep using `./diff.js` — the public surface is re-exported here verbatim.

export {
  type AnnotationMove,
  type DimensionChange,
  DriftError,
  type DriftPolicy,
  type DriftRegion,
  type DriftReport,
  type DriftSeverity,
  type DriftSummary,
  type FieldDelta,
  type FlowDrift,
  type IgnoreRegion,
  type LocatorChange,
  type PngDiffResult,
  type ProseDiff,
  type ScreenshotDiff,
  type StepChange,
} from "./diff-types.js";

export { diffDocPacks, diffPngBuffers } from "./diff-compute.js";

export {
  formatDriftReportMarkdown,
  formatDriftReportText,
  severityAtLeast,
} from "./diff-report.js";
