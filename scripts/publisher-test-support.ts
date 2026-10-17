// Shared scaffolding for the publisher plugin suites (packages/plugin-*/test/publish.test.ts).
//
// Each suite pushes the same two-flow doc pack to its own in-process fake server and watches the
// log lines. The pack builder, the two PNG fixtures and the log capture live here so the suites
// carry only what differs per service. Test-only: nothing here is published or imported by `src/`.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
export const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);

const tempDirs: string[] = [];

/** Two flows, one documented step each: enough for both modes and for image upload. */
export async function makeWorkspace(service: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `docsxai-${service}-test-`));
  tempDirs.push(dir);
  for (const [flow, png] of [
    ["checkout", PNG_A],
    ["login", PNG_B],
  ] as const) {
    await fs.mkdir(path.join(dir, "flows"), { recursive: true });
    await fs.mkdir(path.join(dir, "docs", flow, "burned"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "flows", `${flow}.flow.yaml`),
      `name: ${flow}\nsteps:\n  - id: step-1\n    action: navigate\n    value: /${flow}\n`,
      "utf8",
    );
    await fs.writeFile(path.join(dir, "docs", flow, "step-1.md"), `Go to **${flow}**.\n`, "utf8");
    await fs.writeFile(path.join(dir, "docs", flow, "burned", "step-1.png"), png);
  }
  return dir;
}

/** Removes every workspace `makeWorkspace` created. Call it from `afterAll`. */
export async function removeWorkspaces(): Promise<void> {
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
}

export interface Captured {
  log: { info(message: string): void; warn(message: string): void; error(message: string): void };
  lines: string[];
}

/** A plugin logger that records every line, for the assertions that no secret reaches a log. */
export function capture(): Captured {
  const lines: string[] = [];
  const push = (m: string) => lines.push(m);
  return { log: { info: push, warn: push, error: push }, lines };
}
