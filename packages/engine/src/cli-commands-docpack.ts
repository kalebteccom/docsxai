// Doc-pack ops — the commands that package, render, snapshot, and compare the produced doc pack.
// They read the rendered artifacts (flows/docs/screenshots) and emit something derived; none of
// them drive a live browser:
//   render    — build the static viewer by spawning the docsxai-viewer bin
//   burn      — bake the annotations into PNG copies by spawning the same bin
//   zip       — deterministic single-archive hand-off bundle
//   export    — project the doc pack to ADF (Confluence) or self-contained Playwright specs
//   baseline  — snapshot the doc pack into .baseline/ as the "before" for diff
//   diff      — drift report against a baseline (the after-vs-before)

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  diffDocPacks,
  type DriftSeverity,
  formatDriftReportMarkdown,
  formatDriftReportText,
  severityAtLeast,
} from "./diff.js";
import { projectDocPackToAdf, type AdfExportMode } from "./export/adf.js";
import { exportWorkspaceFlowsAsPlaywrightTests } from "./export/playwright-test.js";
import { writeFileAtomic } from "./atomic-write.js";
import { runViewerBin } from "./viewer-bin.js";
import { ZipError, zipDocPack } from "./zip.js";
import { resolveWorkspacePath } from "./workspace.js";
import { bareValueFlagExit, flagMissingValue, workspaceDirProblem } from "./cli-shared.js";
import { parseCommandFlags } from "./cli-flags.js";
import { describeFsError, shellQuote, usageError, withNext } from "./cli-messages.js";

export async function cmdRender(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("render", args);
  if (typeof parsed === "number") return parsed;
  const { positionals } = parsed;
  const projectDir = positionals[0];
  if (!projectDir) return usageError("render", "missing <workspace-dir>");
  const docsDir = resolveWorkspacePath(projectDir, "docs");
  const outDir = resolveWorkspacePath(projectDir, ".viewer");
  if (
    !(await fs.stat(docsDir).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  ) {
    const note = withNext(
      `warning — ${docsDir} does not exist, so the viewer will be empty`,
      `docsxai run ${shellQuote(projectDir)}`,
    );
    process.stderr.write(`render: ${note}\n`);
  }
  const code = await runViewerBin("render", ["build", docsDir, outDir]);
  if (code === 0) {
    process.stdout.write(
      `render: open ${path.join(outDir, "index.html")}  (the index links the flows; each flow page shows the screenshots — hover a pulsing halo to read its callout)\n`,
    );
  }
  return code;
}

/** A flow name as `burn` passes it on: no separators, and no leading dot, so it can't name a parent or hidden path. */
const FLOW_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

interface BurnArgs {
  workspace: string;
  flows: string[];
  out?: string;
  report?: string;
  plainConnectors: boolean;
}

/** Parse `burn`'s argv. Returns the usage-error message when the argv is malformed. */
function parseBurnArgs(args: string[]): BurnArgs | string {
  const parsed: BurnArgs = { workspace: "", flows: [], plainConnectors: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--no-connector-outline") {
      parsed.plainConnectors = true;
    } else if (a === "--flow" || a === "--out" || a === "--report") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) return `${a} needs a value`;
      if (a === "--flow") parsed.flows.push(value);
      else if (a === "--out") parsed.out = value;
      else parsed.report = value;
    } else if (a.startsWith("--")) {
      return `unknown flag ${a}`;
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length === 0) return "missing <workspace-dir>";
  if (positionals.length > 1) return `unexpected argument "${positionals[1]}"`;
  parsed.workspace = positionals[0]!;
  const bad = parsed.flows.find((f) => !FLOW_NAME.test(f));
  if (bad !== undefined) return `--flow "${bad}" is not a flow name`;
  return parsed;
}

/**
 * `burn` — bake each annotation into a copy of its screenshot, for surfaces that can't run the
 * interactive viewer. The renderer lives in `@docsxai/viewer`; this runs its `burn` command.
 */
export async function cmdBurn(args: string[]): Promise<number> {
  const parsed = parseBurnArgs(args);
  if (typeof parsed === "string") return usageError("burn", parsed);
  const docsDir = resolveWorkspacePath(parsed.workspace, "docs");
  if (
    !(await fs.stat(docsDir).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  ) {
    const note = withNext(
      `${parsed.workspace} has no docs/ directory (expected ${docsDir})`,
      `docsxai run ${shellQuote(parsed.workspace)}`,
    );
    process.stderr.write(`burn: ${note}\n`);
    return 1;
  }
  return runViewerBin("burn", [
    "burn",
    parsed.workspace,
    ...parsed.flows.flatMap((f) => ["--flow", f]),
    ...(parsed.out !== undefined ? ["--out", parsed.out] : []),
    ...(parsed.report !== undefined ? ["--report", parsed.report] : []),
    ...(parsed.plainConnectors ? ["--no-connector-outline"] : []),
  ]);
}

export async function cmdZip(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("zip", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("zip", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareZip = bareValueFlagExit("zip", flags, ["out"]);
  if (bareZip !== undefined) return bareZip;
  const output =
    typeof flags.get("out") === "string"
      ? (flags.get("out") as string)
      : path.join(process.cwd(), `${path.basename(path.resolve(projectDir))}.zip`);
  const includeViewer = flags.get("include-viewer") === true;

  try {
    const r = await zipDocPack({ workspace: projectDir, output, includeViewer });
    const kb = (r.bytes / 1024).toFixed(1);
    process.stdout.write(`zip: wrote ${r.output} (${r.entries.length} entries, ${kb} KB)\n`);
    return 0;
  } catch (e) {
    if (e instanceof ZipError) {
      const next = /nothing to zip/.test(e.message)
        ? `docsxai run ${shellQuote(projectDir)}`
        : /doesn't exist/.test(e.message)
          ? `docsxai init ${shellQuote(projectDir)}  (or fix the path)`
          : /is a directory/.test(e.message)
            ? `docsxai zip ${shellQuote(projectDir)} --out ${shellQuote(path.join(output, `${path.basename(path.resolve(projectDir))}.zip`))}`
            : undefined;
      process.stderr.write(`zip: ${next ? withNext(e.message, next) : e.message}\n`);
      return 1;
    }
    const fsLine = describeFsError(e);
    if (fsLine === undefined) throw e;
    process.stderr.write(`zip: ${fsLine}\n`);
    return 1;
  }
}

/** The text after `<label>: ` for an export that failed: the disk's refusal, or the exporter's message once, with the command that helps. */
function exportFailure(label: string, e: unknown, projectDir: string): string {
  const fsLine = describeFsError(e);
  if (fsLine !== undefined) return fsLine;
  const message = (e as Error).message.replace(`${label}: `, "");
  const dir = shellQuote(projectDir);
  return withNext(
    message,
    /no flow named/.test(message) ? `docsxai flow-tree ${dir}` : `docsxai lint ${dir}`,
  );
}

export async function cmdExport(args: string[]): Promise<number> {
  const [format, ...rest] = args;
  switch (format) {
    case "adf":
      return cmdExportAdf(rest);
    case "playwright":
      return cmdExportPlaywright(rest);
    default:
      return usageError(
        "export",
        format === undefined
          ? "missing format — supported: adf, playwright"
          : `unknown format "${format}" — supported: adf, playwright`,
      );
  }
}

async function cmdExportAdf(rest: string[]): Promise<number> {
  const parsed = parseCommandFlags("export adf", rest);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("export adf", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareAdf = bareValueFlagExit("export adf", flags, ["mode", "flow", "title", "out"]);
  if (bareAdf !== undefined) return bareAdf;
  const modeFlag = flags.get("mode");
  let mode: AdfExportMode = "single";
  if (typeof modeFlag === "string") {
    if (modeFlag !== "single" && modeFlag !== "page-tree") {
      return usageError("export adf", `--mode must be "single" or "page-tree" (got "${modeFlag}")`);
    }
    mode = modeFlag;
  }
  const flow = flags.get("flow");
  const title = flags.get("title");
  const problem = await workspaceDirProblem(projectDir);
  if (problem) {
    process.stderr.write(`export adf: ${problem}\n`);
    return 1;
  }

  try {
    const projection = await projectDocPackToAdf({
      workspaceDir: projectDir,
      ...(typeof flow === "string" ? { flows: [flow] } : {}),
      options: { mode, ...(typeof title === "string" ? { title } : {}) },
    });

    // The agentic-path artifact: a host agent hands these files to the Atlassian MCP (or the
    // confluence publisher plugin consumes them). Default destination is inside the workspace.
    const outFlag = flags.get("out");
    const outDir =
      typeof outFlag === "string"
        ? path.resolve(outFlag)
        : resolveWorkspacePath(projectDir, ".export", "adf");
    await fs.mkdir(outDir, { recursive: true });
    const projectionPath = path.join(outDir, "projection.json");
    const attachmentsPath = path.join(outDir, "attachments.json");
    await writeFileAtomic(projectionPath, JSON.stringify(projection, null, 2) + "\n", "utf8");
    const manifest = projection.documents.flatMap((d) =>
      d.attachments.map((a) => ({ section: d.section, ...a })),
    );
    await writeFileAtomic(attachmentsPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    process.stdout.write(
      `export adf: wrote ${projectionPath} (${projection.documents.length} document${projection.documents.length === 1 ? "" : "s"}, mode ${projection.mode}) + ${attachmentsPath} (${manifest.length} attachment${manifest.length === 1 ? "" : "s"})\n`,
    );
    for (const w of projection.warnings) process.stderr.write(`export adf: warning: ${w}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`export adf: ${exportFailure("export adf", e, projectDir)}\n`);
    return 1;
  }
}

async function cmdExportPlaywright(rest: string[]): Promise<number> {
  const parsed = parseCommandFlags("export playwright", rest);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("export playwright", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const barePlaywright = bareValueFlagExit("export playwright", flags, ["flow", "out"]);
  if (barePlaywright !== undefined) return barePlaywright;
  const flow = flags.get("flow");
  const outFlag = flags.get("out");
  const outDir =
    typeof outFlag === "string"
      ? path.resolve(outFlag)
      : resolveWorkspacePath(projectDir, ".export", "tests");
  const problem = await workspaceDirProblem(projectDir);
  if (problem) {
    process.stderr.write(`export playwright: ${problem}\n`);
    return 1;
  }

  try {
    const specs = await exportWorkspaceFlowsAsPlaywrightTests({
      workspaceDir: projectDir,
      ...(typeof flow === "string" ? { flows: [flow] } : {}),
    });
    await fs.mkdir(outDir, { recursive: true });
    for (const spec of specs) {
      await fs.writeFile(path.join(outDir, spec.fileName), spec.content, "utf8");
    }
    process.stdout.write(
      `export playwright: wrote ${specs.length} spec${specs.length === 1 ? "" : "s"} to ${outDir}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(
      `export playwright: ${exportFailure("export playwright", e, projectDir)}\n`,
    );
    return 1;
  }
}

/** Copy `src` → `dest` if `src` exists. Returns 1 if copied, 0 if absent. */
async function copyIfExists(src: string, dest: string): Promise<number> {
  try {
    await fs.access(src);
  } catch {
    return 0;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  return 1;
}

export async function cmdBaseline(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("baseline", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("baseline", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bare = flagMissingValue(flags, ["out"]);
  if (bare) return usageError("baseline", `--${bare} needs a value`);
  const outFlag = flags.get("out");
  const outDir =
    typeof outFlag === "string"
      ? path.resolve(outFlag)
      : resolveWorkspacePath(projectDir, ".baseline");
  if (outDir === path.resolve(projectDir)) {
    return usageError(
      "baseline",
      "--out cannot be the workspace itself: a refresh clears <out>/flows and <out>/docs first",
    );
  }
  const problem = await workspaceDirProblem(projectDir);
  if (problem) {
    process.stderr.write(`baseline: ${problem}\n`);
    return 1;
  }

  let stage = "";
  try {
    // Refresh = replace: a baseline is a derived snapshot, so the previous one is dropped whole
    // rather than merged (a stale leftover file would read as drift). The new snapshot is built
    // in a staging directory first and swapped in, so a failed copy keeps the previous baseline.
    stage = path.join(outDir, `.staging-${process.pid}-${randomBytes(4).toString("hex")}`);
    let copied = 0;
    const flowsDir = resolveWorkspacePath(projectDir, "flows");
    for (const entry of (await fs.readdir(flowsDir).catch(() => [] as string[])).sort()) {
      if (!entry.endsWith(".flow.yaml")) continue;
      copied += await copyIfExists(path.join(flowsDir, entry), path.join(stage, "flows", entry));
    }

    const docsDir = resolveWorkspacePath(projectDir, "docs");
    copied += await copyIfExists(
      path.join(docsDir, "locators.yaml"),
      path.join(stage, "docs", "locators.yaml"),
    );
    const docEntries = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of docEntries.sort((x, y) => x.name.localeCompare(y.name))) {
      if (!entry.isDirectory()) continue;
      const flowDir = path.join(docsDir, entry.name);
      const outFlowDir = path.join(stage, "docs", entry.name);
      for (const f of (await fs.readdir(flowDir).catch(() => [] as string[])).sort()) {
        if (f.endsWith(".md") || f === "annotations.json") {
          copied += await copyIfExists(path.join(flowDir, f), path.join(outFlowDir, f));
        }
      }
      const shotsDir = path.join(flowDir, "screenshots");
      for (const f of (await fs.readdir(shotsDir).catch(() => [] as string[])).sort()) {
        if (!f.endsWith(".png")) continue;
        copied += await copyIfExists(
          path.join(shotsDir, f),
          path.join(outFlowDir, "screenshots", f),
        );
      }
    }

    for (const part of ["flows", "docs"]) {
      await fs.rm(path.join(outDir, part), { recursive: true, force: true });
      await fs.rename(path.join(stage, part), path.join(outDir, part)).catch((e: unknown) => {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      });
    }

    process.stdout.write(
      `baseline: snapshotted ${copied} file${copied === 1 ? "" : "s"} to ${outDir}\n`,
    );
    if (copied === 0) {
      const note = withNext(
        "warning — no flows/ or docs/ files found to snapshot",
        `docsxai run ${shellQuote(projectDir)}`,
      );
      process.stderr.write(`baseline: ${note}\n`);
    }
    return 0;
  } catch (e) {
    // The staging directory is an implementation detail; report the output directory instead.
    const err = e as NodeJS.ErrnoException;
    if (stage && err.path?.startsWith(stage)) err.path = outDir;
    process.stderr.write(`baseline: ${describeFsError(e) ?? (e as Error).message}\n`);
    return 1;
  } finally {
    if (stage) await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function cmdDiff(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("diff", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("diff", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bare = flagMissingValue(flags, ["against", "format"]);
  if (bare) return usageError("diff", `--${bare} needs a value`);
  const againstFlag = flags.get("against");
  const againstDir =
    typeof againstFlag === "string"
      ? path.resolve(againstFlag)
      : resolveWorkspacePath(projectDir, ".baseline");

  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "json" && format !== "md" && format !== "text") {
    return usageError("diff", `--format must be json | md | text (got "${format}")`);
  }
  const failOnFlag = flags.get("fail-on");
  let failOn: DriftSeverity | null = null;
  if (failOnFlag !== undefined) {
    if (failOnFlag !== "warn" && failOnFlag !== "fail") {
      return usageError("diff", `--fail-on must be warn | fail (got "${String(failOnFlag)}")`);
    }
    failOn = failOnFlag;
  }

  try {
    await fs.access(path.join(againstDir, "flows"));
  } catch {
    const note = withNext(
      `no baseline at ${againstDir}`,
      `docsxai baseline ${shellQuote(projectDir)}  (or pass --against <dir>)`,
    );
    process.stderr.write(`diff: ${note}\n`);
    return 2;
  }

  try {
    const report = await diffDocPacks(againstDir, projectDir);
    if (format === "json") process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else if (format === "md") process.stdout.write(formatDriftReportMarkdown(report));
    else process.stdout.write(formatDriftReportText(report));
    if (failOn !== null && severityAtLeast(report.summary.severity, failOn)) return 1;
    return 0;
  } catch (e) {
    process.stderr.write(`diff: ${(e as Error).message}\n`);
    return 1;
  }
}
