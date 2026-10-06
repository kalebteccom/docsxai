// The `run --verify-determinism` report: the shape, its three renderings (json, md, text) and the
// exit code it maps to. No timestamps, no absolute paths, no durations: the same runs always
// render the same bytes, so the report can be diffed, cached and attached to a pipeline. Halt
// messages are cut to their first line and scrubbed of absolute paths (`scrubHaltMessage`); every
// other path in the report is relative to a run root.

import type { ArtefactDifference } from "./verify-compare.js";

export type VerifyStatus = "identical" | "differing" | "halted";

// Each pattern finds one kind of absolute path. A POSIX path needs two segments and must not follow a
// word character, `:`, `/` or `.`, so URLs (`http://host/a/b`), `a/b` and a lone `/done` stay.
const ABSOLUTE_PATH_PATTERNS: RegExp[] = [
  /file:\/\/[^\s"'`<>()[\]{}]*/g,
  /(?<![\w:/.~-])(?:\/[^\s"'`<>()[\]{}/]+){2,}/g,
  /(?<!\w)[A-Za-z]:[\\/][^\s"'`<>()[\]{}]*/g,
  /\\\\[^\s\\"'`<>]+\\[^\s"'`<>()[\]{}]*/g,
];

// Roots that identify a machine or a user. A path under one is scrubbed whole, even a single
// segment (`/tmp`) and even one with a space in a directory name.
const FIXED_ROOTS = ["/tmp", "/var/tmp", "/private/tmp", "/Users", "/home"];
const PATH_CHAR = "[^\\s\"'`<>()[\\]{}]";
const TRAIL_PUNCTUATION = /[.,;:!?]+$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * One pattern for a path under any of `roots`. Inside quotes or brackets the run goes to the
 * closing delimiter, spaces included. Outside them it goes to the next space, and across a space
 * only when the next word holds a separator (`/Users/me/My Projects/app`).
 */
function rootedPathPattern(roots: string[]): RegExp {
  const alt = roots
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .join("|");
  const inside = `(?<=["'\`(\\[<])(?:${alt})(?:[\\\\/][^"'\`<>()\\[\\]{}\\n]*|(?![\\w-]))`;
  const outside = `(?<![\\w:/.~-])(?:${alt})(?:[\\\\/]${PATH_CHAR}*(?: +(?=${PATH_CHAR}*[\\\\/])${PATH_CHAR}+)*|(?![\\w-]))`;
  return new RegExp(`${inside}|${outside}`, "g");
}

function replacePath(match: string): string {
  return `<path>${TRAIL_PUNCTUATION.exec(match)?.[0] ?? ""}`;
}

/**
 * What a halt message becomes in the report: its first line, with every absolute path (POSIX,
 * Windows drive, UNC, `file://`) replaced by `<path>`. A path under `/tmp`, `/Users`, `/home` or one
 * of `roots` (the workspace root, the home and temp directories of the machine) is scrubbed to the
 * end of its token run first. A run on one machine and a run on another then print the same
 * report, and a CI log does not carry a home directory.
 */
export function scrubHaltMessage(message: string, roots: readonly string[] = []): string {
  const known = new Set(FIXED_ROOTS);
  for (const root of roots) {
    const trimmed = root.replace(/[\\/]+$/, "");
    if (trimmed.length > 1) known.add(trimmed);
  }
  let line = (message.split("\n")[0] ?? "").replace(rootedPathPattern([...known]), replacePath);
  for (const pattern of ABSOLUTE_PATH_PATTERNS) line = line.replace(pattern, replacePath);
  return line;
}

/** A flow that did not finish in one of the runs. */
export interface VerifyHalt {
  run: number;
  flow: string;
  /** The step the runtime halted on; null when the flow never started (browser launch failure). */
  step: string | null;
  message: string;
}

export interface VerifyReport {
  schema: "docsxai/verify-determinism@1";
  runs: number;
  /** Names of the flows that ran, sorted. */
  flows: string[];
  /**
   * `identical`: every run wrote the same bytes and finished. `differing`: at least one artefact
   * differs between runs. `halted`: a flow halted in some run, so there is nothing to verify as a doc pack.
   */
  status: VerifyStatus;
  /** Artefacts in run 1. */
  artefacts_compared: number;
  /** The first differing artefact by path, run order breaking ties. */
  first: ArtefactDifference | null;
  /** Every differing artefact, ordered by path then run. */
  differences: ArtefactDifference[];
  halts: VerifyHalt[];
  /** True when run 1's output replaced the workspace output (only when status is `identical`). */
  promoted: boolean;
}

/** Exit code for a finished verification: 0 identical, 1 differing or halted. Usage errors (2) never reach a report. */
export function verifyExitCode(report: VerifyReport): 0 | 1 {
  return report.status === "identical" ? 0 : 1;
}

export function buildVerifyReport(input: {
  runs: number;
  flows: string[];
  artefactsCompared: number;
  differences: ArtefactDifference[];
  halts: VerifyHalt[];
  promoted: boolean;
  /** Directories whose paths are scrubbed from halt messages: the workspace root, home, temp. */
  scrubRoots?: readonly string[];
}): VerifyReport {
  const status: VerifyStatus =
    input.halts.length > 0 ? "halted" : input.differences.length > 0 ? "differing" : "identical";
  return {
    schema: "docsxai/verify-determinism@1",
    runs: input.runs,
    flows: [...input.flows].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    status,
    artefacts_compared: input.artefactsCompared,
    first: input.differences[0] ?? null,
    differences: input.differences,
    halts: input.halts.map((h) => ({
      ...h,
      message: scrubHaltMessage(h.message, input.scrubRoots),
    })),
    promoted: input.promoted,
  };
}

function headline(r: VerifyReport): string {
  const n = r.flows.length;
  return `${r.runs} runs of ${n} flow${n === 1 ? "" : "s"} (${r.flows.join(", ")}), ${r.artefacts_compared} artefact${r.artefacts_compared === 1 ? "" : "s"} per run`;
}

function outcome(r: VerifyReport): string {
  if (r.status === "identical") {
    return "All runs wrote identical bytes; run 1's output is now the workspace output";
  }
  return "The workspace output was not touched";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatVerifyReportText(r: VerifyReport): string {
  const lines = [`verify-determinism: ${headline(r)}`, `result: ${r.status.toUpperCase()}`];
  if (r.first) {
    lines.push(
      `first differing artefact: ${r.first.path} (run ${r.first.run} vs run 1)`,
      `  cause: ${r.first.hint}`,
    );
    const rest = r.differences.filter((d) => d !== r.first);
    if (rest.length > 0) lines.push(`also differing (${rest.length}):`);
    for (const d of rest) lines.push(`  ${d.path} (run ${d.run}): ${d.hint}`);
  }
  if (r.halts.length > 0) lines.push(`halted flows (${r.halts.length}):`);
  for (const h of r.halts) {
    lines.push(
      `  run ${h.run}, ${h.flow}${h.step ? `, step ${h.step}` : ""}: ${h.message.split("\n")[0]}`,
    );
  }
  lines.push(outcome(r));
  return lines.join("\n") + "\n";
}

export function formatVerifyReportMarkdown(r: VerifyReport): string {
  const lines = [
    "## docsxai determinism check",
    "",
    `**${r.status.toUpperCase()}**: ${headline(r)}.`,
    "",
  ];
  if (r.first) {
    lines.push(
      `First differing artefact: \`${r.first.path}\` (run ${r.first.run} vs run 1).`,
      "",
      `- Cause: ${r.first.hint}`,
      "",
    );
    if (r.differences.length > 1) {
      lines.push(
        `All ${plural(r.differences.length, "difference")}:`,
        "",
        "| Artefact | Run | Cause |",
        "| --- | --- | --- |",
      );
      for (const d of r.differences) {
        lines.push(`| \`${d.path}\` | ${d.run} | ${d.hint.replace(/\|/g, "\\|")} |`);
      }
      lines.push("");
    }
  }
  if (r.halts.length > 0) {
    lines.push(`Halted flows (${r.halts.length}):`, "");
    for (const h of r.halts) {
      lines.push(
        `- run ${h.run}, \`${h.flow}\`${h.step ? `, step \`${h.step}\`` : ""}: ${h.message.split("\n")[0]}`,
      );
    }
    lines.push("");
  }
  lines.push(`${outcome(r)}.`, "");
  return lines.join("\n");
}

export function formatVerifyReportJson(r: VerifyReport): string {
  return JSON.stringify(r, null, 2) + "\n";
}
