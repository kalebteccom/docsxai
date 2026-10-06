// Doc-pack ops — the commands that package, render, snapshot, and compare the produced doc pack.
// They read the rendered artifacts (flows/docs/screenshots) and emit something derived; none of
// them drive a live browser:
//   render    — build the static viewer by spawning the docsxai-viewer bin
//   burn      — bake the annotations into PNG copies by spawning the same bin
//   zip       — deterministic single-archive hand-off bundle
//   export    — project the doc pack to ADF (Confluence) or self-contained Playwright specs
//   baseline  — snapshot the doc pack into .baseline/ as the "before" for diff
//   diff      — drift report against a baseline (the after-vs-before)

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { FlowFileError } from "./flow-file.js";
import {
  diffDocPacks,
  type DriftSeverity,
  formatDriftReportMarkdown,
  formatDriftReportText,
  severityAtLeast,
} from "./diff.js";
import { projectDocPackToAdf, type AdfExportMode } from "./export/adf.js";
import { exportWorkspaceFlowsAsPlaywrightTests } from "./export/playwright-test.js";
import { formatViewerBinFailure, resolveViewerBin } from "./viewer-bin.js";
import { ZipError, zipDocPack } from "./zip.js";
import { resolveWorkspacePath } from "./workspace.js";
import { parseFlags } from "./cli-shared.js";
import { USAGE } from "./cli-usage.js";

/**
 * Run the viewer's CLI with `args` and resolve to its exit code. The viewer is its own package/bin;
 * spawning it keeps the engine from depending on it at build time. `label` prefixes the failure
 * line when the bin can't be launched.
 */
async function runViewerBin(label: string, args: string[]): Promise<number> {
  const viewerBin = await resolveViewerBin();
  return new Promise<number>((resolve) => {
    const child = spawn(viewerBin.command, [...viewerBin.prefixArgs, ...args], {
      stdio: "inherit",
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        process.stderr.write(`${label}: ${formatViewerBinFailure(viewerBin)}\n`);
      } else {
        process.stderr.write(`${label}: ${e.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function cmdRender(args: string[]): Promise<number> {
  const { positionals } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("render: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const docsDir = resolveWorkspacePath(projectDir, "docs");
  const outDir = resolveWorkspacePath(projectDir, ".viewer");
  const code = await runViewerBin("render", ["build", docsDir, outDir]);
  if (code === 0) {
    process.stdout.write(
      `render: open ${path.join(outDir, "index.html")}  (the index links the flows; each flow page shows the screenshots — hover a pulsing halo to read its callout)\n`,
    );
  }
  return code;
}

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
  const bad = parsed.flows.find((f) => f === "." || f === ".." || /[\\/]/.test(f));
  if (bad !== undefined) return `--flow "${bad}" is not a flow name`;
  return parsed;
}

/**
 * `burn` — bake each annotation into a copy of its screenshot, for surfaces that can't run the
 * interactive viewer. The renderer lives in `@docsxai/viewer`; this runs its `burn` command.
 */
export async function cmdBurn(args: string[]): Promise<number> {
  const parsed = parseBurnArgs(args);
  if (typeof parsed === "string") {
    process.stderr.write(`burn: ${parsed}\n\n${USAGE}\n`);
    return 2;
  }
  const docsDir = resolveWorkspacePath(parsed.workspace, "docs");
  if (
    !(await fs.stat(docsDir).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  ) {
    process.stderr.write(
      `burn: ${parsed.workspace} has no docs/ directory (expected ${docsDir}). Run \`docsxai run\` first.\n`,
    );
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
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`zip: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
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
      process.stderr.write(`zip: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export async function cmdExport(args: string[]): Promise<number> {
  const [format, ...rest] = args;
  switch (format) {
    case "adf":
      return cmdExportAdf(rest);
    case "playwright":
      return cmdExportPlaywright(rest);
    default:
      process.stderr.write(
        `export: unknown format "${format ?? ""}" — supported: adf, playwright\n`,
      );
      return 2;
  }
}

async function cmdExportAdf(rest: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(rest);
  if (!positionals[0]) {
    process.stderr.write(`export adf: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const modeFlag = flags.get("mode");
  let mode: AdfExportMode = "single";
  if (typeof modeFlag === "string") {
    if (modeFlag !== "single" && modeFlag !== "page-tree") {
      process.stderr.write(
        `export adf: --mode must be "single" or "page-tree" (got "${modeFlag}")\n`,
      );
      return 2;
    }
    mode = modeFlag;
  }
  const flow = flags.get("flow");
  const title = flags.get("title");

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
    await fs.writeFile(projectionPath, JSON.stringify(projection, null, 2) + "\n", "utf8");
    const manifest = projection.documents.flatMap((d) =>
      d.attachments.map((a) => ({ section: d.section, ...a })),
    );
    await fs.writeFile(attachmentsPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    process.stdout.write(
      `export adf: wrote ${projectionPath} (${projection.documents.length} document${projection.documents.length === 1 ? "" : "s"}, mode ${projection.mode}) + ${attachmentsPath} (${manifest.length} attachment${manifest.length === 1 ? "" : "s"})\n`,
    );
    for (const w of projection.warnings) process.stderr.write(`export adf: warning: ${w}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`export adf: ${(e as Error).message}\n`);
    return 1;
  }
}

async function cmdExportPlaywright(rest: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(rest);
  if (!positionals[0]) {
    process.stderr.write(`export playwright: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const flow = flags.get("flow");
  const outFlag = flags.get("out");
  const outDir =
    typeof outFlag === "string"
      ? path.resolve(outFlag)
      : resolveWorkspacePath(projectDir, ".export", "tests");

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
    if (e instanceof FlowFileError) {
      process.stderr.write(`export playwright: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`export playwright: ${(e as Error).message}\n`);
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
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`baseline: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const outFlag = flags.get("out");
  const outDir =
    typeof outFlag === "string"
      ? path.resolve(outFlag)
      : resolveWorkspacePath(projectDir, ".baseline");

  try {
    // Refresh = replace: a baseline is a derived snapshot, so the previous one is dropped whole
    // rather than merged (a stale leftover file would read as drift).
    await fs.rm(path.join(outDir, "flows"), { recursive: true, force: true });
    await fs.rm(path.join(outDir, "docs"), { recursive: true, force: true });

    let copied = 0;
    const flowsDir = resolveWorkspacePath(projectDir, "flows");
    for (const entry of (await fs.readdir(flowsDir).catch(() => [] as string[])).sort()) {
      if (!entry.endsWith(".flow.yaml")) continue;
      copied += await copyIfExists(path.join(flowsDir, entry), path.join(outDir, "flows", entry));
    }

    const docsDir = resolveWorkspacePath(projectDir, "docs");
    copied += await copyIfExists(
      path.join(docsDir, "locators.yaml"),
      path.join(outDir, "docs", "locators.yaml"),
    );
    const docEntries = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of docEntries.sort((x, y) => x.name.localeCompare(y.name))) {
      if (!entry.isDirectory()) continue;
      const flowDir = path.join(docsDir, entry.name);
      const outFlowDir = path.join(outDir, "docs", entry.name);
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

    process.stdout.write(
      `baseline: snapshotted ${copied} file${copied === 1 ? "" : "s"} to ${outDir}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`baseline: ${(e as Error).message}\n`);
    return 1;
  }
}

export async function cmdDiff(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`diff: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const againstFlag = flags.get("against");
  const againstDir =
    typeof againstFlag === "string"
      ? path.resolve(againstFlag)
      : resolveWorkspacePath(projectDir, ".baseline");

  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "json" && format !== "md" && format !== "text") {
    process.stderr.write(`diff: --format must be json | md | text (got "${format}")\n`);
    return 2;
  }
  const failOnFlag = flags.get("fail-on");
  let failOn: DriftSeverity | null = null;
  if (failOnFlag !== undefined) {
    if (failOnFlag !== "warn" && failOnFlag !== "fail") {
      process.stderr.write(`diff: --fail-on must be warn | fail (got "${String(failOnFlag)}")\n`);
      return 2;
    }
    failOn = failOnFlag;
  }

  try {
    await fs.access(path.join(againstDir, "flows"));
  } catch {
    process.stderr.write(
      `diff: no baseline at ${againstDir} — run \`docsxai baseline ${projectDir}\` first (or pass --against <dir>)\n`,
    );
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
