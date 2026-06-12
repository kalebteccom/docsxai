import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listCommands,
  listSkills,
  pluginDir,
  readManifest,
  validateManifest,
  validatePluginBundle,
  type ValidationIssue,
} from "../src/index.js";

// Keep this list aligned with the engine's CLI dispatch (packages/engine/src/cli.ts).
// If the engine grows a new command, add the matching commands/<name>.md and update this list.
const KNOWN_CLI_COMMANDS = [
  "init",
  "calibrate",
  "inspect",
  "run",
  "render",
  "capture-auth",
  "lint",
  "flow-tree",
  "diagnose",
  "style",
  "zip",
  "login",
  "push",
  "pull",
  "plugins",
  "export",
];

describe("plugin scaffold — basics", () => {
  it("has a well-formed manifest", async () => {
    const m = await readManifest();
    expect(m.name).toBe("docsxai");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(m.description.length).toBeGreaterThan(20);
  });

  it("ships the deterministic commands", async () => {
    const cmds = await listCommands();
    expect(cmds).toEqual(expect.arrayContaining(["login", "render", "run", "push", "pull"]));
  });

  it("ships the calibration skills calibrate/diagnose", async () => {
    expect(await listSkills()).toEqual(expect.arrayContaining(["calibrate", "diagnose"]));
  });
});

describe("validateManifest", () => {
  it("returns no issues for a clean manifest", () => {
    expect(
      validateManifest({
        name: "docsxai",
        version: "0.1.0",
        description: "A reasonable description with enough characters.",
        homepage: "https://example.com",
      }),
    ).toEqual([]);
  });

  it("flags missing name as an error", () => {
    const issues = validateManifest({ version: "1.0.0", description: "ok ok ok ok ok ok ok ok" });
    expect(issues.find((i) => i.message.match(/name/))?.severity).toBe("error");
  });

  it("flags non-semver version as an error", () => {
    const issues = validateManifest({
      name: "x",
      version: "rc1",
      description: "ok ok ok ok ok ok ok ok",
    });
    expect(issues.find((i) => i.message.match(/version/))?.severity).toBe("error");
  });

  it("warns on non-URL homepage", () => {
    const issues = validateManifest({
      name: "x",
      version: "0.1.0",
      description: "ok ok ok ok ok ok ok ok ok ok",
      homepage: "not-a-url",
    });
    expect(issues.find((i) => i.message.match(/homepage/))?.severity).toBe("warning");
  });
});

describe("validatePluginBundle (static validation)", () => {
  it("the bundled plugin has no errors against the known CLI surface", async () => {
    const issues = await validatePluginBundle({ knownCliCommands: KNOWN_CLI_COMMANDS });
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) {
      throw new Error(
        `validatePluginBundle errors:\n${errors.map((i: ValidationIssue) => `  [${i.where}] ${i.message}`).join("\n")}`,
      );
    }
  });

  it("every command body references its underlying `docsxai <name>` CLI command", async () => {
    const issues = await validatePluginBundle({ knownCliCommands: KNOWN_CLI_COMMANDS });
    const misalignedWrappers = issues.filter((i) => i.message.includes("doesn't appear to invoke"));
    expect(misalignedWrappers, misalignedWrappers.map((i) => i.where).join(", ")).toEqual([]);
  });

  it("every command is known to the engine CLI", async () => {
    const issues = await validatePluginBundle({ knownCliCommands: KNOWN_CLI_COMMANDS });
    const unknown = issues.filter((i) => i.message.includes("isn't in the engine CLI surface"));
    expect(unknown, unknown.map((i) => i.where).join(", ")).toEqual([]);
  });
});

describe("plugin scaffold — frontmatter shape", () => {
  it("every command .md has a `description:` frontmatter line", async () => {
    for (const cmd of await listCommands()) {
      const text = await fs.readFile(path.join(pluginDir, "commands", `${cmd}.md`), "utf8");
      expect(text, `${cmd}.md`).toMatch(/^---[\s\S]*?\ndescription:\s+\S/m);
    }
  });

  it("every SKILL.md has `name:` and `description:` frontmatter", async () => {
    for (const skill of await listSkills()) {
      const text = await fs.readFile(path.join(pluginDir, "skills", skill, "SKILL.md"), "utf8");
      expect(text, `${skill}/SKILL.md`).toMatch(/^---[\s\S]*?\nname:\s+\S/m);
      expect(text, `${skill}/SKILL.md`).toMatch(/^---[\s\S]*?\ndescription:\s+\S/m);
    }
  });
});
