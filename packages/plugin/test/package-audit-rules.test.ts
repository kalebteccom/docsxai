// The tarball rules behind scripts/audit-package-contents.mjs: which paths a packed @docsxai/plugin
// and @docsxai/skill must contain, and that the forbidden-path patterns leave `.claude-plugin/` alone.
// Lives here because the plugin and skill trees are what the required list reads.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PATTERNS,
  missingPaths,
  requiredPaths,
} from "../../../scripts/package-audit-rules.mjs";
import { listCommands, listSkills, pluginDir } from "../src/index.js";

const skillDir = path.resolve(pluginDir, "..", "skill");
const readPkg = async (dir: string) =>
  JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    main?: string;
    bin?: Record<string, string>;
  };
const forbidden = (p: string): string[] =>
  FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(p)).map(({ why }) => why);

describe("required tarball paths", () => {
  it("the plugin needs its manifest, every command, every skill and its main", async () => {
    const required = requiredPaths(pluginDir, await readPkg(pluginDir));
    expect(required).toContain("dist/index.js");
    expect(required).toContain(".claude-plugin/plugin.json");
    for (const cmd of await listCommands()) expect(required).toContain(`commands/${cmd}.md`);
    for (const skill of await listSkills()) expect(required).toContain(`skills/${skill}/SKILL.md`);
  });

  it("the skill bundle needs skill/docsxai/SKILL.md and its main", async () => {
    const required = requiredPaths(skillDir, await readPkg(skillDir));
    expect(required).toEqual(expect.arrayContaining(["dist/index.js", "skill/docsxai/SKILL.md"]));
    await expect(fs.access(path.join(skillDir, "skill", "docsxai", "SKILL.md"))).resolves.toBe(
      undefined,
    );
  });

  it("a package with only a main and bins needs exactly those, `./` stripped", () => {
    expect(
      requiredPaths("/nonexistent", {
        name: "x",
        main: "./dist/index.js",
        bin: { x: "./bin.mjs" },
      }),
    ).toEqual(["dist/index.js", "bin.mjs"]);
  });

  it("names every missing path, and none that is present", async () => {
    const required = requiredPaths(pluginDir, await readPkg(pluginDir));
    const old = ["LICENSE", "README.md", "package.json", "dist/index.js", "dist/index.d.ts"];
    const missing = missingPaths(old, required);
    expect(missing).toContain(".claude-plugin/plugin.json");
    expect(missing).toContain("commands/run.md");
    expect(missing).toContain("skills/calibrate/SKILL.md");
    expect(missing).not.toContain("dist/index.js");
    expect(missingPaths(required, required)).toEqual([]);
  });
});

describe("forbidden path patterns", () => {
  it("do not catch .claude-plugin/, commands/ or skills/", () => {
    for (const p of [
      ".claude-plugin/plugin.json",
      "commands/run.md",
      "skills/calibrate/SKILL.md",
      "skill/docsxai/SKILL.md",
    ]) {
      expect(forbidden(p), p).toEqual([]);
    }
  });

  it("still catch a .claude directory and a tests directory", () => {
    expect(forbidden(".claude/settings.json")).not.toEqual([]);
    expect(forbidden("test/plugin.test.js")).not.toEqual([]);
  });
});
