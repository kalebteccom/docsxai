import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { listCommands, listSkills, pluginDir, readManifest } from "../src/index.js";

describe("plugin scaffold", () => {
  it("has a well-formed manifest", async () => {
    const m = await readManifest();
    expect(m.name).toBe("site-docs");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.description.length).toBeGreaterThan(20);
  });

  it("ships the deterministic commands run/render/login", async () => {
    const cmds = await listCommands();
    expect(cmds).toEqual(expect.arrayContaining(["login", "render", "run"]));
  });

  it("ships the calibration skills calibrate/diagnose", async () => {
    expect(await listSkills()).toEqual(expect.arrayContaining(["calibrate", "diagnose"]));
  });

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
