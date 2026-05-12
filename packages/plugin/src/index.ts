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
