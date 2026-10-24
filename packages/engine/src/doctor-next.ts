// The command `docsxai doctor` suggests after a passing check list, read from the workspace's
// state: no workspace, then init --example; no flow, then add-flow; nothing captured, then run;
// annotations present, then render --open.

import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { shellQuote } from "./cli-messages.js";
import { WORKSPACE_CONFIG_FILE } from "./workspace.js";

async function hasFlowFile(flowsDir: string): Promise<boolean> {
  try {
    return (await fs.readdir(flowsDir)).some((e) => e.endsWith(".flow.yaml"));
  } catch {
    return false;
  }
}

/** Whether `docs/<flow>/annotations.json` or `docs/<flow>/<variant>/annotations.json` exists. */
async function hasAnnotations(docsDir: string): Promise<boolean> {
  let flows: string[];
  try {
    flows = await fs.readdir(docsDir);
  } catch {
    return false;
  }
  for (const flow of flows) {
    const flowDir = path.join(docsDir, flow);
    if (existsSync(path.join(flowDir, "annotations.json"))) return true;
    const variants = await fs.readdir(flowDir).catch(() => [] as string[]);
    if (variants.some((v) => existsSync(path.join(flowDir, v, "annotations.json")))) return true;
  }
  return false;
}

/**
 * The next command for the workspace at `workspaceDir`. `dirArg` is the directory the user typed,
 * or `undefined` when doctor ran in the current directory; the command repeats it as typed.
 */
export async function doctorNextStep(
  dirArg: string | undefined,
  workspaceDir: string,
): Promise<string> {
  const root = path.resolve(workspaceDir);
  const isWorkspace =
    existsSync(path.join(root, WORKSPACE_CONFIG_FILE)) || existsSync(path.join(root, "flows"));
  if (!isWorkspace) {
    return `docsxai init ${dirArg === undefined ? "<workspace-dir>" : shellQuote(dirArg)} --example`;
  }
  const ws = shellQuote(dirArg ?? ".");
  if (!(await hasFlowFile(path.join(root, "flows")))) {
    return `docsxai add-flow ${ws} --from <flow.yaml>`;
  }
  if (!(await hasAnnotations(path.join(root, "docs")))) return `docsxai run ${ws}`;
  return `docsxai render ${ws} --open`;
}
