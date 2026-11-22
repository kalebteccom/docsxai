// Which variants of a matrix flow were not refreshed since its flow file last changed. A variant is
// stale when its `annotations.json` is older than the flow file, and missing when it has none. The
// check reads file times only, so a fresh git checkout (every file stamped at checkout time) can hide
// staleness, and a change in a parent flow (`extends`) is not seen. `run` prints the result after
// its summary; it never changes the exit code.

import { promises as fs } from "node:fs";
import type { FlowFile } from "./doc-pack.js";
import { matrixVariantIds, variantDocDir } from "./flow-matrix.js";
import { resolveWorkspacePath } from "./workspace.js";

export interface StaleVariants {
  flow: string;
  total: number;
  stale: string[];
  missing: string[];
}

async function mtimeMs(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** For each matrix flow, the variants that are older than the flow file or have no output. Flows with nothing to report are left out. */
export async function findStaleVariants(
  projectDir: string,
  entries: ReadonlyArray<{ flow: FlowFile; filePath: string }>,
): Promise<StaleVariants[]> {
  const found: StaleVariants[] = [];
  for (const { flow, filePath } of entries) {
    if (!flow.matrix) continue;
    const flowTime = await mtimeMs(filePath);
    if (flowTime === null) continue;
    const ids = matrixVariantIds(flow.matrix);
    const stale: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const file = resolveWorkspacePath(
        projectDir,
        ...variantDocDir(flow.name, id).split("/"),
        "annotations.json",
      );
      const time = await mtimeMs(file);
      if (time === null) missing.push(id);
      else if (time < flowTime) stale.push(id);
    }
    if (stale.length > 0 || missing.length > 0) {
      found.push({ flow: flow.name, total: ids.length, stale, missing });
    }
  }
  return found;
}

const SHOWN = 4;

function list(ids: string[]): string {
  const head = ids.slice(0, SHOWN).join(", ");
  return ids.length > SHOWN ? `${head}, and ${ids.length - SHOWN} more` : head;
}

/** The lines `run` prints after its summary, or an empty string when every variant is current. */
export function formatStaleVariants(found: readonly StaleVariants[], dirArg: string): string {
  const lines: string[] = [];
  for (const f of found) {
    const parts: string[] = [];
    if (f.stale.length > 0) parts.push(`${f.stale.length} stale (${list(f.stale)})`);
    if (f.missing.length > 0) parts.push(`${f.missing.length} missing (${list(f.missing)})`);
    lines.push(
      `run: ${f.flow}: ${parts.join(", ")} of ${f.total} variants`,
      `  next: docsxai run ${dirArg} --flow ${f.flow}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}
