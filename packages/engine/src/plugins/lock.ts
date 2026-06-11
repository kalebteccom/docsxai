// plugins-lock.json + the plugin keys of `.site-docs.json`.
//
// The lock pins the sha256 of each plugin's register-module bytes. When the file exists, every
// resolve verifies the hash BEFORE importing — a silently-swapped module fails closed with a
// "run `site-docs plugins sync`" message. `site-docs plugins sync` (re)writes it without ever
// executing plugin code.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { resolveWorkspacePath, WORKSPACE_CONFIG_FILE } from "../workspace.js";

export const PLUGINS_LOCK_FILE = "plugins-lock.json";
export const PLUGINS_LOCK_SCHEMA = "site-docs/plugins-lock@1";

/** Where a plugin comes from: an installed package (resolved via Node) or a local directory. */
export type PluginSourceSpec = { package: string } | { path: string };

export interface PluginsLockEntry {
  source: string;
  version: string;
  /** Hex sha256 of the register module's file bytes. */
  sha256: string;
}

export interface PluginsLockFile {
  schema: typeof PLUGINS_LOCK_SCHEMA;
  plugins: Record<string, PluginsLockEntry>;
}

export class PluginsLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginsLockError";
  }
}

const lockSchema = z
  .object({
    schema: z.literal(PLUGINS_LOCK_SCHEMA),
    plugins: z.record(
      z.object({ source: z.string(), version: z.string(), sha256: z.string() }).strict(),
    ),
  })
  .strict();

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lockPath(workspaceDir: string): string {
  return resolveWorkspacePath(workspaceDir, PLUGINS_LOCK_FILE);
}

/** Read `<workspace>/plugins-lock.json`. `null` when absent; throws on a malformed file. */
export async function readPluginsLock(workspaceDir: string): Promise<PluginsLockFile | null> {
  const p = lockPath(workspaceDir);
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PluginsLockError(`${p} is not valid JSON — fix or delete it, then run \`site-docs plugins sync\``);
  }
  const result = lockSchema.safeParse(raw);
  if (!result.success) {
    throw new PluginsLockError(
      `${p} does not match schema "${PLUGINS_LOCK_SCHEMA}" — delete it and run \`site-docs plugins sync\``,
    );
  }
  return result.data;
}

/** Write `<workspace>/plugins-lock.json` (deterministic key order). Returns the path written. */
export async function writePluginsLock(
  workspaceDir: string,
  lock: PluginsLockFile,
): Promise<string> {
  const p = lockPath(workspaceDir);
  const ordered: PluginsLockFile = {
    schema: lock.schema,
    plugins: Object.fromEntries(
      Object.entries(lock.plugins).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await fs.writeFile(p, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Verify a resolved plugin against the lock. Returns `null` when the entry matches, or a
 * human-actionable mismatch reason. Callers turn a non-null reason into a `load-error`.
 */
export function verifyLock(
  lock: PluginsLockFile,
  namespace: string,
  registerBytes: Uint8Array | null,
): string | null {
  const entry = lock.plugins[namespace];
  if (!entry) {
    return `plugin "${namespace}" is not in ${PLUGINS_LOCK_FILE} — run \`site-docs plugins sync\``;
  }
  if (registerBytes === null) {
    return `plugin "${namespace}" register module is unreadable — reinstall it, then run \`site-docs plugins sync\``;
  }
  const actual = sha256Hex(registerBytes);
  if (actual !== entry.sha256) {
    return (
      `lock mismatch for plugin "${namespace}": register module sha256 ${actual} does not match ` +
      `${PLUGINS_LOCK_FILE} (${entry.sha256}) — if the change is intentional, run \`site-docs plugins sync\``
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// `.site-docs.json` plugin keys
// ---------------------------------------------------------------------------
//
// Two optional keys extend the workspace config:
//   "plugins":             [{ "package": "<npm-name>" } | { "path": "<dir>" }, …]
//   "plugin_capabilities": ["egress:<host-glob>", …]
// Parsed here from the raw JSON (the core workspace config schema stays untouched).

export interface WorkspacePluginsConfig {
  sources: PluginSourceSpec[];
  capabilities: string[];
}

export class PluginsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginsConfigError";
  }
}

const sourceSchema = z.union([
  z.object({ package: z.string().min(1) }).strict(),
  z.object({ path: z.string().min(1) }).strict(),
]);

const pluginsConfigSchema = z.object({
  plugins: z.array(sourceSchema).default([]),
  plugin_capabilities: z.array(z.string()).default([]),
});

/** Read the plugin keys from `<workspace>/.site-docs.json`. Absent file → empty config. */
export async function readWorkspacePluginsConfig(
  workspaceDir: string,
): Promise<WorkspacePluginsConfig> {
  const p = resolveWorkspacePath(workspaceDir, WORKSPACE_CONFIG_FILE);
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return { sources: [], capabilities: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PluginsConfigError(`${p} is not valid JSON`);
  }
  const result = pluginsConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; ");
    throw new PluginsConfigError(`${p}: invalid plugin configuration — ${detail}`);
  }
  return { sources: result.data.plugins, capabilities: result.data.plugin_capabilities };
}
