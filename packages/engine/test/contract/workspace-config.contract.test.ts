// Contract: the workspace (`.docsxai.json` keys, the files `docsxai init` scaffolds) and the
// DOCSX_* environment variables the packages read.
//
// Snapshot: snapshots/workspace-config.json. `.docsxai.json` is described by the
// `WorkspaceConfig` interface (read from source text); the scaffold layout comes from running
// `initWorkspace` into a temp directory; the environment variables are the `KNOWN_DOCSX_ENV_VARS`
// list `docsxai doctor` checks against, so a variable a package starts reading without being
// listed there is caught by the doctor tests and a variable that disappears is caught here.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed config key, a removed variable or a changed scaffold
//      path is a breaking change; a new optional key or variable is additive.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectJsonSnapshot, typeMembers } from "../../../../scripts/contract-support.js";
import { parseAuthStrategyFile } from "../../src/auth/index.js";
import { KNOWN_DOCSX_ENV_VARS } from "../../src/doctor-checks.js";
import { initWorkspace, loadWorkspaceConfig, WORKSPACE_CONFIG_FILE } from "../../src/workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceSource = path.join(here, "..", "..", "src", "workspace.ts");

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-contract-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function scaffold(
  name: string,
  opts: { auth?: "manual-capture" | "none"; appUrl?: string },
): Promise<{ created: string[]; configKeys: string[] }> {
  const dir = path.join(tmp, name);
  const result = await initWorkspace({ dir, ...opts });
  const config = JSON.parse(
    await fs.readFile(path.join(dir, WORKSPACE_CONFIG_FILE), "utf8"),
  ) as Record<string, unknown>;
  return { created: result.created, configKeys: Object.keys(config).sort() };
}

describe("workspace contract", () => {
  it("matches the checked-in workspace and environment snapshot", async () => {
    const withAuth = await scaffold("with-auth", { appUrl: "http://localhost:3000" });
    const withoutAuth = await scaffold("without-auth", { auth: "none" });
    expectJsonSnapshot(path.join(here, "snapshots", "workspace-config.json"), {
      configFile: WORKSPACE_CONFIG_FILE,
      workspaceConfig: typeMembers(workspaceSource, "WorkspaceConfig"),
      scaffold: {
        manualCapture: withAuth,
        none: withoutAuth,
      },
      env: [...KNOWN_DOCSX_ENV_VARS],
    });
  });

  it("scaffolds a gitignore for the operator-local directories and a parseable auth descriptor", async () => {
    const dir = path.join(tmp, "ws");
    await initWorkspace({ dir, role: "reviewer", ttl: "30m" });
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toBe(".auth/\n.viewer/\n");
    const descriptor = parseAuthStrategyFile(
      await fs.readFile(path.join(dir, "auth", "strategy.yaml"), "utf8"),
    );
    expect(descriptor.default_role).toBe("reviewer");
    expect(descriptor.roles["reviewer"]?.strategy).toBe("manual-capture");
    expect(descriptor.roles["reviewer"]?.cache).toMatchObject({ enabled: true, ttl: "30m" });
  });

  it("only reads a config whose schema id is docsxai/workspace@1", async () => {
    const dir = path.join(tmp, "ws");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, WORKSPACE_CONFIG_FILE);
    await fs.writeFile(
      file,
      JSON.stringify({ schema: "docsxai/workspace@1", app_url: "http://localhost:3000" }),
    );
    expect((await loadWorkspaceConfig(dir))?.app_url).toBe("http://localhost:3000");
    await fs.writeFile(file, JSON.stringify({ schema: "docsxai/workspace@2" }));
    expect(await loadWorkspaceConfig(dir)).toBeNull();
  });
});
