// The closing line of a plain `docsxai run`: how many flows (or flow variants) finished, where the
// outputs went, and for each failure the command that digs into it. Success goes to stdout with the
// progress lines; a failure goes to stderr with the halt messages it summarises.

import * as path from "node:path";
import { sanitizeForTerminal, shellQuote } from "./cli-messages.js";
import { type FlowFailure } from "./run-flows.js";

export interface RunSummaryInput {
  projectDir: string;
  /** `flows` or `flow variants`. */
  noun: string;
  /** How many units were attempted. */
  total: number;
  okCount: number;
  failures: FlowFailure[];
}

/** The command to run for a failure: `diagnose` for a halted step, `doctor` when the browser never started. */
export function nextForFailure(projectDir: string, f: FlowFailure): string {
  const dir = shellQuote(projectDir);
  if (f.step === null) return `docsxai doctor ${dir}`;
  const slash = f.flow.indexOf("/");
  const flow = slash === -1 ? f.flow : f.flow.slice(0, slash);
  const variant = slash === -1 ? "" : ` --variant ${shellQuote(f.flow.slice(slash + 1))}`;
  return `docsxai diagnose ${dir} --flow ${shellQuote(flow)} --step ${shellQuote(f.step)}${variant}`;
}

export function formatRunSummary(input: RunSummaryInput): string {
  const { projectDir, noun, total, okCount, failures } = input;
  const where = path.join(projectDir, "docs");
  const unit = total === 1 ? noun.replace(/s$/, "") : noun;
  if (failures.length === 0) return `run: ${okCount} of ${total} ${unit} ok, outputs in ${where}\n`;
  const lines = [
    `run: ${failures.length} of ${total} ${unit} failed, ${okCount} ok; outputs in ${where}`,
  ];
  for (const f of failures)
    lines.push(`  ${sanitizeForTerminal(f.flow)}: next: ${nextForFailure(projectDir, f)}`);
  return lines.join("\n") + "\n";
}

/** Write the summary on the stream that fits the outcome. */
export function reportRun(input: RunSummaryInput): void {
  const text = formatRunSummary(input);
  (input.failures.length === 0 ? process.stdout : process.stderr).write(text);
}
