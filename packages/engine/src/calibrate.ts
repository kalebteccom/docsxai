// Calibration — the deterministic, structured-input path.
//
// `site-docs calibrate <workspace> --from <flow.md|.yaml>` takes a *structured flow-guide* — a flow-file in
// YAML, or a Markdown doc containing a ```yaml fenced block that parses as one (the the first-consumer testing guide
// shape: prerequisites + locators reference + per-step actions + success criteria) — and writes it as
// `<workspace>/flows/<name>.flow.yaml`, plus a default `docs/style.yaml` if absent. Then `site-docs run`
// exercises it against the live app to fill in screenshots + bounding boxes + the real `annotations.json`.
//
// Loose-prose flow descriptions (and live element-picking / ambiguity resolution) need the host agent —
// that's the `/site-docs:calibrate` *skill* (see packages/plugin/skills/calibrate/SKILL.md) plus the
// pause/resume pipeline contract (pipeline.ts). This module covers only the part that's deterministic.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { type FlowFile, type StyleArtifact } from "./doc-pack.js";
import { FlowFileError, parseFlowFile, serializeFlowFile } from "./flow-file.js";

export class CalibrateError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "CalibrateError";
  }
}

const YAML_FENCE = /```ya?ml\s*\n([\s\S]*?)\n```/i;

/**
 * Extract a flow-file from a structured flow-guide. Accepts: the YAML of a flow-file directly, or a Markdown
 * doc whose first ```yaml fenced block parses as one. Throws {@link CalibrateError} if neither works (which is
 * the signal that the input is loose prose → use the calibrate skill / agent path instead).
 */
export function extractFlowFile(text: string, source = "<flow-guide>"): FlowFile {
  // 1. The whole text as flow-file YAML.
  try {
    return parseFlowFile(text, source);
  } catch (e) {
    if (!(e instanceof FlowFileError)) throw e;
  }
  // 2. A ```yaml fenced block.
  const m = YAML_FENCE.exec(text);
  if (m) {
    try {
      return parseFlowFile(m[1]!, `${source} (yaml block)`);
    } catch (e) {
      if (e instanceof FlowFileError) {
        throw new CalibrateError(
          `${source}: found a yaml block but it isn't a valid flow-file:\n${e.message}`,
          e,
        );
      }
      throw e;
    }
  }
  throw new CalibrateError(
    `${source}: not a structured flow-guide (no parseable flow-file YAML found).\n` +
      `\`calibrate --from\` only takes a flow-file in YAML, or a Markdown doc with a \`\`\`yaml fenced block that *is* one.\n` +
      `Loose prose — e.g. a hand-written test guide whose fenced blocks are numbered prose pseudo-steps for an agent\n` +
      `to *test* rather than flow-file YAML — must be turned into a flow-file by hand: follow the /site-docs:calibrate skill\n` +
      `(walk the live app via Claude in Chrome, pin one canonical locator per step), then \`calibrate --from\` it or just \`run\`.`,
  );
}

const DEFAULT_STYLE: StyleArtifact = {
  schema: "site-docs/style@1",
  voice: { tone: "concise, instructional, second-person ('you')", audience: "end users (not engineers)" },
  structure: { per_step: "one short imperative sentence + a screenshot; no internal jargon" },
  terminology: {},
  // testing-jargon categories the commit stage must strip from user-facing prose:
  pruning_rules: ["VERIFY/EXPECT/ASSERT directives", "WAIT directives", "internal locator names", "network-verification blocks"],
};

export interface CalibrateOptions {
  workspaceDir: string;
  /** The flow-guide text. */
  fromText: string;
  /** Where it came from (for error messages). */
  fromSource?: string;
  /** Override the flow name (default: the flow-file's `name`). */
  flowName?: string;
}

export interface CalibrateResult {
  flow: FlowFile;
  /** Path the flow-file was written to. */
  flowFilePath: string;
  /** Path of the style artifact (whether newly written or pre-existing). */
  stylePath: string;
  /** True if the style artifact was newly written (false if it already existed and was left alone). */
  wroteStyle: boolean;
}

/** Run the deterministic calibration step: extract the flow-file from a structured guide, write it + a default style. */
export async function calibrate(opts: CalibrateOptions): Promise<CalibrateResult> {
  const flow = extractFlowFile(opts.fromText, opts.fromSource ?? "<flow-guide>");
  const name = opts.flowName ?? flow.name;

  const flowsDir = path.join(opts.workspaceDir, "flows");
  await fs.mkdir(flowsDir, { recursive: true });
  const flowFilePath = path.join(flowsDir, `${name}.flow.yaml`);
  await fs.writeFile(flowFilePath, serializeFlowFile(flow), "utf8");

  const docsDir = path.join(opts.workspaceDir, "docs");
  await fs.mkdir(docsDir, { recursive: true });
  const stylePath = path.join(docsDir, "style.yaml");
  let wroteStyle = false;
  try {
    await fs.access(stylePath);
  } catch {
    await fs.writeFile(stylePath, stringifyYaml(DEFAULT_STYLE, { lineWidth: 100 }), "utf8");
    wroteStyle = true;
  }

  return { flow, flowFilePath, stylePath, wroteStyle };
}
