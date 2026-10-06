// CLI glue for `docsxai run --verify-determinism`: parse and validate its flags (usage errors are
// exit 2), and print the finished report in the chosen format. The verification itself lives in
// verify-determinism.ts; this file only knows argv and stdout.

import { DEFAULT_RUNS, MAX_RUNS, MIN_RUNS } from "./verify-determinism.js";
import {
  formatVerifyReportJson,
  formatVerifyReportMarkdown,
  formatVerifyReportText,
  verifyExitCode,
  type VerifyReport,
} from "./verify-report.js";

export type VerifyFormat = "json" | "md" | "text";

export interface VerifyArgs {
  runs: number;
  format: VerifyFormat;
}

/** Flags that make a verification meaningless: they stop a flow early, keep a browser open or attach to someone else's. */
const INCOMPATIBLE = ["pause", "stop-after", "start-from", "cdp"] as const;

/**
 * Read the verification flags of `run`. Returns `null` when verification is off, the usage-error
 * message when the flags are wrong, and the parsed arguments otherwise. `--runs` and `--format`
 * belong to verification, so they are rejected without `--verify-determinism`.
 */
export function parseVerifyArgs(flags: Map<string, string | true>): VerifyArgs | string | null {
  const verify = flags.get("verify-determinism");
  if (verify === undefined) {
    for (const f of ["runs", "format"]) {
      if (flags.has(f)) return `--${f} requires --verify-determinism`;
    }
    return null;
  }
  if (verify !== true) {
    return `--verify-determinism takes no value (got "${verify}"); put <workspace-dir> before it`;
  }
  for (const f of INCOMPATIBLE) {
    if (flags.has(f)) return `--verify-determinism cannot be combined with --${f}`;
  }
  const runsFlag = flags.get("runs");
  let runs = DEFAULT_RUNS;
  if (runsFlag !== undefined) {
    const n = typeof runsFlag === "string" && /^\d+$/.test(runsFlag) ? Number(runsFlag) : NaN;
    if (!(n >= MIN_RUNS && n <= MAX_RUNS)) {
      return `--runs must be an integer from ${MIN_RUNS} to ${MAX_RUNS} (got "${String(runsFlag)}")`;
    }
    runs = n;
  }
  const formatFlag = flags.get("format");
  const format = formatFlag === undefined ? "text" : formatFlag;
  if (format !== "json" && format !== "md" && format !== "text") {
    return `--format must be json | md | text (got "${String(format)}")`;
  }
  return { runs, format };
}

/** Print the report on stdout and return the exit code it maps to (0 identical, 1 differing or halted). */
export function emitVerifyReport(report: VerifyReport, format: VerifyFormat): number {
  const text =
    format === "json"
      ? formatVerifyReportJson(report)
      : format === "md"
        ? formatVerifyReportMarkdown(report)
        : formatVerifyReportText(report);
  process.stdout.write(text);
  return verifyExitCode(report);
}
