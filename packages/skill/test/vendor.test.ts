import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vendorSkill, vendoredSkillDir } from "../src/index.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-skill-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("vendorSkill", () => {
  it("ships a site-docs/SKILL.md in the bundle with proper frontmatter", async () => {
    const text = await fs.readFile(path.join(vendoredSkillDir, "site-docs", "SKILL.md"), "utf8");
    expect(text).toMatch(/^---[\s\S]*?\nname:\s+site-docs/m);
    expect(text).toMatch(/^---[\s\S]*?\ndescription:\s+\S/m);
    expect(text).toMatch(/@kalebtec\/site-docs plugin/);
  });

  it("copies the bundle into <projectDir>/.claude/skills/site-docs/", async () => {
    const dest = await vendorSkill(tmp);
    expect(dest).toBe(path.join(tmp, ".claude", "skills", "site-docs"));
    await expect(fs.access(path.join(dest, "SKILL.md"))).resolves.toBeUndefined();
  });
});
