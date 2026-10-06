// Contract: what the Claude Code plugin ships: its slash-command names, its skill names and the
// keys of `.claude-plugin/plugin.json`.
//
// Snapshot: snapshots/plugin-surface.json. Users type `/docsxai:<command>` and agents load skills
// by name, so a rename is a break even though no code changes.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed or renamed command or skill is a breaking change; a new
//      one is additive.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { expectJsonSnapshot } from "../../../../scripts/contract-support.js";
import { listCommands, listSkills, pluginDir } from "../../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("plugin surface contract", () => {
  it("matches the checked-in plugin snapshot", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    expectJsonSnapshot(path.join(here, "snapshots", "plugin-surface.json"), {
      commands: await listCommands(),
      skills: await listSkills(),
      manifestKeys: Object.keys(manifest).sort(),
    });
  });
});
