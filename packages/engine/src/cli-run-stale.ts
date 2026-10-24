// A flow that gained a `matrix` writes its variants under docs/<flow>/<variant>/, so an
// annotations.json left at docs/<flow>/ from before is stale. Split out of the `run` handler.

import { promises as fs } from "node:fs";
import { resolveWorkspacePath } from "./workspace.js";

/** One stderr warning per matrix flow in `matrixFlows` that still has a pre-matrix docs/<flow>/annotations.json. */
export async function warnStaleMatrixOutputs(
  projectDir: string,
  matrixFlows: ReadonlySet<string>,
): Promise<void> {
  for (const name of matrixFlows) {
    const stale = resolveWorkspacePath(projectDir, "docs", name, "annotations.json");
    if (
      await fs.access(stale).then(
        () => true,
        () => false,
      )
    ) {
      process.stderr.write(
        `run: warning: docs/${name}/annotations.json is from before ${name} had a matrix; its variants write to docs/${name}/<variant>/, so remove the old docs/${name}/ outputs\n`,
      );
    }
  }
}
