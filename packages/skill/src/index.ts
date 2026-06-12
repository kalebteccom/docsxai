// @docsxai/skill — the vendorable colocated `.claude/skills/docsxai/` fallback.
//
// Secondary path: teams that want to pin docsxai behavior into a project copy this bundle into their
// repo. It carries no logic — it delegates to the @docsxai/plugin's commands/skills and the
// `docsxai` CLI. `vendorSkill()` does the copy.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the vendorable bundle (`skill/`), which contains `docsxai/SKILL.md`. */
export const vendoredSkillDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "skill",
);

/**
 * Copy the vendored skill bundle into `<projectDir>/.claude/skills/`.
 * @returns the destination path (`<projectDir>/.claude/skills/docsxai`).
 */
export async function vendorSkill(projectDir: string): Promise<string> {
  const src = path.join(vendoredSkillDir, "docsxai");
  const dest = path.join(projectDir, ".claude", "skills", "docsxai");
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true });
  return dest;
}
