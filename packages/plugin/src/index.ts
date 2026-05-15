// @kalebtec/site-docs-plugin — the Claude Code plugin (first-class invocation surface).
//
// The plugin itself is the markdown/JSON tree alongside this file:
//   .claude-plugin/plugin.json   — manifest
//   commands/*.md                — deterministic slash commands (thin wrappers over the `site-docs` CLI)
//   skills/*/SKILL.md            — calibration skills (agent-driven; the host supplies inference)
// This module is a small TS surface over that tree, for tooling/tests.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the plugin root (the directory containing `.claude-plugin/`). */
export const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: { name: string };
  homepage?: string;
}

/** Read and parse `.claude-plugin/plugin.json`. */
export async function readManifest(): Promise<PluginManifest> {
  const text = await fs.readFile(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8");
  return JSON.parse(text) as PluginManifest;
}

/** Names of the slash commands the plugin ships (from `commands/*.md`). */
export async function listCommands(): Promise<string[]> {
  const entries = await fs.readdir(path.join(pluginDir, "commands")).catch(() => [] as string[]);
  return entries.filter((e) => e.endsWith(".md")).map((e) => e.replace(/\.md$/, "")).sort();
}

/** Names of the skills the plugin ships (directories under `skills/` that contain a `SKILL.md`). */
export async function listSkills(): Promise<string[]> {
  const entries = await fs.readdir(path.join(pluginDir, "skills"), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const has = await fs
        .access(path.join(pluginDir, "skills", e.name, "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      if (has) out.push(e.name);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Static validation — runs in tests; also usable from a CLI / CI lint pass.
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: "error" | "warning";
  where: string;
  message: string;
}

/** Validate the manifest's shape + content. Synchronous; no I/O beyond what the caller already did. */
export function validateManifest(m: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const where = ".claude-plugin/plugin.json";
  if (typeof m !== "object" || m === null) {
    return [{ severity: "error", where, message: "manifest must be an object" }];
  }
  const o = m as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) {
    issues.push({ severity: "error", where, message: "missing or empty `name`" });
  }
  if (typeof o.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(o.version)) {
    issues.push({ severity: "error", where, message: `\`version\` must be semver (got ${JSON.stringify(o.version)})` });
  }
  if (typeof o.description !== "string" || o.description.length < 20) {
    issues.push({ severity: "warning", where, message: "`description` is missing or under 20 chars" });
  }
  if (o.homepage !== undefined) {
    if (typeof o.homepage !== "string" || !/^https?:\/\//.test(o.homepage)) {
      issues.push({ severity: "warning", where, message: "`homepage` should be an http(s) URL" });
    }
  }
  if (o.author !== undefined) {
    if (typeof o.author !== "object" || o.author === null || typeof (o.author as Record<string, unknown>).name !== "string") {
      issues.push({ severity: "warning", where, message: "`author` should be { name: string }" });
    }
  }
  return issues;
}

/** Parse a `.md` file's leading `---` YAML-ish frontmatter into a `key: value` record (no nested parsing). */
function parseFrontmatter(text: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\n/)) {
    const kv = /^(\w+):\s*(.+)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

/** Validate the whole plugin bundle. Cross-checks command names against the optional `knownCliCommands` list. */
export async function validatePluginBundle(opts: { knownCliCommands?: string[] } = {}): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Manifest
  let manifest: unknown;
  try {
    manifest = await readManifest();
  } catch (e) {
    return [{ severity: "error", where: ".claude-plugin/plugin.json", message: `unreadable: ${(e as Error).message}` }];
  }
  issues.push(...validateManifest(manifest));

  // Commands
  const cmdNames = await listCommands();
  if (cmdNames.length === 0) {
    issues.push({ severity: "warning", where: "commands/", message: "no commands declared" });
  }
  const seenCmd = new Set<string>();
  for (const cmd of cmdNames) {
    if (seenCmd.has(cmd)) {
      issues.push({ severity: "error", where: `commands/${cmd}.md`, message: "duplicate command name" });
    }
    seenCmd.add(cmd);
    const file = path.join(pluginDir, "commands", `${cmd}.md`);
    const text = await fs.readFile(file, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm) {
      issues.push({ severity: "error", where: `commands/${cmd}.md`, message: "missing YAML frontmatter (`--- … ---`)" });
      continue;
    }
    if (!fm.description || fm.description.length < 5) {
      issues.push({ severity: "error", where: `commands/${cmd}.md`, message: "frontmatter `description:` missing or too short" });
    }
    // Body should reference an underlying engine command of the same name (`site-docs <cmd>`).
    const body = text.slice(text.indexOf("---", 3) + 3);
    if (!new RegExp(`\\bsite-docs\\s+${cmd}\\b`).test(body)) {
      issues.push({
        severity: "warning",
        where: `commands/${cmd}.md`,
        message: `body doesn't appear to invoke \`site-docs ${cmd}\` — wrapper may be misaligned with the underlying CLI`,
      });
    }
    if (opts.knownCliCommands && !opts.knownCliCommands.includes(cmd)) {
      issues.push({
        severity: "warning",
        where: `commands/${cmd}.md`,
        message: `\`site-docs ${cmd}\` isn't in the engine CLI surface (known: ${opts.knownCliCommands.join(", ")})`,
      });
    }
  }

  // Skills
  for (const skill of await listSkills()) {
    const file = path.join(pluginDir, "skills", skill, "SKILL.md");
    const text = await fs.readFile(file, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm) {
      issues.push({ severity: "error", where: `skills/${skill}/SKILL.md`, message: "missing frontmatter" });
      continue;
    }
    if (!fm.name || fm.name.length === 0) {
      issues.push({ severity: "error", where: `skills/${skill}/SKILL.md`, message: "frontmatter `name:` missing" });
    }
    if (!fm.description || fm.description.length < 20) {
      issues.push({ severity: "warning", where: `skills/${skill}/SKILL.md`, message: "frontmatter `description:` missing or under 20 chars" });
    }
  }

  return issues;
}
