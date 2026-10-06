// `docsxai run --verify-determinism`: run the selected flows N times, each into its own output root
// under `<workspace>/.docsxai-verify/run-<k>/`, then byte-compare every artefact.
//
// The workspace output (docs/<flow>/…) is only written when every run agrees: run 1's tree is copied
// in then, and it is the same bytes a plain `run` would have written. When the runs differ or a flow
// halts, the workspace is left exactly as it was. The run roots are removed at the end by the paths
// listed in them (see verify-tree.ts); there is no recursive delete.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runFlowsInSessions, type FlowFailure, type RunFlowsOptions } from "./run-flows.js";
import { compareRuns } from "./verify-compare.js";
import { buildVerifyReport, type VerifyHalt, type VerifyReport } from "./verify-report.js";
import { assertRegularTree, copyTree, removeListedTree } from "./verify-tree.js";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

export const VERIFY_DIR = ".docsxai-verify";
export const MIN_RUNS = 2;
export const MAX_RUNS = 5;
export const DEFAULT_RUNS = 2;

export type VerifyRunOptions = Omit<RunFlowsOptions, "outputRoot" | "progress" | "pause"> & {
  runs: number;
  progress: (line: string) => void;
};

/** Root of run `k` (1-based) under the workspace. */
export function runRoot(projectDir: string, k: number): string {
  return resolveWorkspacePath(projectDir, VERIFY_DIR, `run-${k}`);
}

/** Workspace-relative path of a flow's halt context inside a run root. */
export function haltContextRelPath(flow: string): string {
  return path.posix.join("docs", flow, "halts", "halt-context.json");
}

async function writeHaltContext(root: string, failure: FlowFailure): Promise<void> {
  const rel = haltContextRelPath(failure.flow);
  const abs = await resolveWorkspacePathReal(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const body = {
    schema: "docsxai/halt-context@1",
    flow: failure.flow,
    step: failure.step,
    message: failure.message,
  };
  await fs.writeFile(abs, JSON.stringify(body, null, 2) + "\n", "utf8");
}

async function cleanUp(projectDir: string, runs: number): Promise<void> {
  for (let k = 1; k <= runs; k++) await removeListedTree(runRoot(projectDir, k));
  // The parent only goes when it is empty; anything else in it stays.
  await fs.rmdir(resolveWorkspacePath(projectDir, VERIFY_DIR)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT" && e.code !== "ENOTEMPTY" && e.code !== "EEXIST") throw e;
  });
}

/** Run the flows `opts.runs` times into isolated roots, compare, and promote run 1 when all agree. */
export async function verifyDeterminism(opts: VerifyRunOptions): Promise<VerifyReport> {
  const { runs, projectDir } = opts;
  const halts: VerifyHalt[] = [];
  try {
    // A crashed earlier verification may have left run roots behind; they are ours by name.
    await cleanUp(projectDir, MAX_RUNS);
    const roots: string[] = [];
    for (let k = 1; k <= runs; k++) {
      const outputRoot = runRoot(projectDir, k);
      await fs.mkdir(outputRoot, { recursive: true });
      opts.progress(`verify-determinism: run ${k} of ${runs}\n`);
      const result = await runFlowsInSessions({ ...opts, pause: false, outputRoot });
      for (const failure of result.failures) {
        await writeHaltContext(outputRoot, failure);
        halts.push({ run: k, ...failure });
      }
      roots.push(outputRoot);
    }
    // A symlink in a run root would be read through by the comparison and refused by the copy.
    for (const root of roots) await assertRegularTree(root);
    const compared = await compareRuns(roots);
    const identical = compared.differences.length === 0 && halts.length === 0;
    if (identical) await copyTree(roots[0]!, path.resolve(projectDir));
    return buildVerifyReport({
      runs,
      flows: opts.flows.map((f) => f.name),
      artefactsCompared: compared.compared,
      differences: compared.differences,
      halts,
      promoted: identical,
      scrubRoots: [path.resolve(projectDir), os.homedir(), os.tmpdir()],
    });
  } finally {
    await cleanUp(projectDir, MAX_RUNS);
  }
}
