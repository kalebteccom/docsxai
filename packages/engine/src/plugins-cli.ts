// `site-docs plugins <list|info|sync>` — the operator surface over the plugin runtime.
//
//   list  — resolve + load the workspace's plugins; print the full status table.
//   info  — manifest + registered artifact names for one plugin (by namespace).
//   sync  — (re)write plugins-lock.json from the resolved manifests. Never executes plugin code.
//
// All three honour `--format json` for tooling.

import { promises as fs } from "node:fs";
import {
  PLUGINS_LOCK_FILE,
  PLUGINS_LOCK_SCHEMA,
  PluginsConfigError,
  PluginsLockError,
  type PluginsLockFile,
  readPluginsLock,
  readWorkspacePluginsConfig,
  sha256Hex,
  writePluginsLock,
} from "./plugins/lock.js";
import type { PluginRecord } from "./plugins/registry.js";
import { resolvePlugins, resolvePluginSources } from "./plugins/runtime.js";

const PLUGINS_USAGE = `site-docs plugins — workspace plugin runtime

Usage:
  site-docs plugins list <workspace-dir> [--format text|json]
  site-docs plugins info <workspace-dir> <namespace> [--format text|json]
  site-docs plugins sync <workspace-dir> [--format text|json]

Notes:
  • Plugins are declared in the workspace's .site-docs.json:
      "plugins":             [{ "package": "<npm-name>" } | { "path": "<dir>" }, …]
      "plugin_capabilities": ["egress:<host-glob>", …]
  • list resolves and loads the declared set, then prints every plugin's status (loaded, or the
    disabled/error reason). Exit 1 if any declared plugin is not loaded.
  • sync pins each plugin's register-module sha256 into ${PLUGINS_LOCK_FILE} next to the config.
    When the lock exists, every resolve verifies the bytes before importing — a changed module
    fails closed until you re-run sync. sync itself never executes plugin code.
`;

function parseFlags(args: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function parseFormat(flags: Map<string, string | true>): "text" | "json" | null {
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  return format === "text" || format === "json" ? format : null;
}

function formatRecordText(r: PluginRecord, indent = "  "): string {
  const id = r.namespace || r.name;
  const kinds = r.manifest ? r.manifest.kinds.join(",") : "-";
  let out = `${indent}${id}  ${r.status}  v${r.version}  ${r.trust}  ${kinds}  ${r.source}\n`;
  if (r.statusReason) out += `${indent}    ↳ ${r.statusReason}\n`;
  return out;
}

async function loadRegistry(workspaceDir: string) {
  const cfg = await readWorkspacePluginsConfig(workspaceDir);
  const lock = await readPluginsLock(workspaceDir);
  const registry = await resolvePlugins({
    workspaceDir,
    sources: cfg.sources,
    enabledCapabilities: cfg.capabilities,
    lock,
  });
  return { cfg, registry };
}

async function cmdList(workspaceDir: string, format: "text" | "json"): Promise<number> {
  const { registry } = await loadRegistry(workspaceDir);
  const records = registry.listPlugins();
  if (format === "json") {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
  } else if (records.length === 0) {
    process.stdout.write('plugins: none configured (add a "plugins" array to .site-docs.json)\n');
  } else {
    const loaded = records.filter((r) => r.status === "loaded").length;
    process.stdout.write(`plugins (${records.length} configured, ${loaded} loaded):\n`);
    for (const r of records) process.stdout.write(formatRecordText(r));
  }
  return records.every((r) => r.status === "loaded") ? 0 : 1;
}

async function cmdInfo(
  workspaceDir: string,
  namespace: string,
  format: "text" | "json",
): Promise<number> {
  const { registry } = await loadRegistry(workspaceDir);
  const record = registry.pluginsInfo(namespace);
  if (!record) {
    const known = registry
      .listPlugins()
      .map((r) => r.namespace || r.name)
      .join(", ");
    process.stderr.write(
      `plugins info: no plugin "${namespace}"${known ? ` (configured: ${known})` : " (none configured)"}\n`,
    );
    return 1;
  }
  if (format === "json") {
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
    return record.status === "loaded" ? 0 : 1;
  }
  process.stdout.write(formatRecordText(record, ""));
  if (record.manifest) {
    process.stdout.write(`  apiVersion: ${record.manifest.apiVersion}\n`);
    process.stdout.write(
      `  capabilities: ${record.manifest.capabilities.join(", ") || "(none)"}\n`,
    );
    process.stdout.write(
      `  dependsOn: ${
        record.manifest.dependsOn.map((d) => `${d.plugin}@${d.version}`).join(", ") || "(none)"
      }\n`,
    );
  }
  process.stdout.write(`  artifacts (${record.artifacts.length}):\n`);
  for (const a of record.artifacts) process.stdout.write(`    ${a.kind}  ${a.name}\n`);
  return record.status === "loaded" ? 0 : 1;
}

async function cmdSync(workspaceDir: string, format: "text" | "json"): Promise<number> {
  const cfg = await readWorkspacePluginsConfig(workspaceDir);
  const resolutions = await resolvePluginSources(workspaceDir, cfg.sources);
  const failures: Array<{ source: string; reason: string }> = [];
  const lock: PluginsLockFile = { schema: PLUGINS_LOCK_SCHEMA, plugins: {} };
  for (const r of resolutions) {
    if (!r.ok) {
      failures.push({ source: r.record.source, reason: r.record.statusReason ?? "unresolvable" });
      continue;
    }
    const ns = r.candidate.manifest.namespace;
    if (lock.plugins[ns]) {
      failures.push({
        source: r.candidate.source,
        reason: `namespace "${ns}" is claimed by more than one configured plugin — cannot lock`,
      });
      delete lock.plugins[ns];
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(r.candidate.registerPath);
    } catch {
      failures.push({
        source: r.candidate.source,
        reason: `register module not found at ${r.candidate.registerPath}`,
      });
      continue;
    }
    lock.plugins[ns] = {
      source: r.candidate.source,
      version: r.candidate.version,
      sha256: sha256Hex(bytes),
    };
  }
  const lockPath = await writePluginsLock(workspaceDir, lock);
  const entryCount = Object.keys(lock.plugins).length;
  if (format === "json") {
    process.stdout.write(JSON.stringify({ lockPath, lock, failures }, null, 2) + "\n");
  } else {
    process.stdout.write(`plugins sync: wrote ${lockPath} (${entryCount} plugin(s))\n`);
    for (const [ns, entry] of Object.entries(lock.plugins)) {
      process.stdout.write(
        `  ${ns}  v${entry.version}  ${entry.sha256.slice(0, 12)}…  ${entry.source}\n`,
      );
    }
    for (const f of failures) {
      process.stderr.write(`plugins sync: NOT locked ${f.source} — ${f.reason}\n`);
    }
  }
  return failures.length > 0 ? 1 : 0;
}

export async function pluginsCli(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(PLUGINS_USAGE);
    return sub === undefined ? 2 : 0;
  }
  if (sub !== "list" && sub !== "info" && sub !== "sync") {
    process.stderr.write(`plugins: unknown subcommand "${sub}"\n\n${PLUGINS_USAGE}`);
    return 2;
  }
  const { positionals, flags } = parseFlags(rest);
  const workspaceDir = positionals[0];
  if (!workspaceDir) {
    process.stderr.write(`plugins ${sub}: missing <workspace-dir>\n\n${PLUGINS_USAGE}`);
    return 2;
  }
  const format = parseFormat(flags);
  if (!format) {
    process.stderr.write(`plugins ${sub}: --format must be "text" or "json"\n`);
    return 2;
  }
  try {
    switch (sub) {
      case "list":
        return await cmdList(workspaceDir, format);
      case "info": {
        const namespace = positionals[1];
        if (!namespace) {
          process.stderr.write(`plugins info: missing <namespace>\n\n${PLUGINS_USAGE}`);
          return 2;
        }
        return await cmdInfo(workspaceDir, namespace, format);
      }
      case "sync":
        return await cmdSync(workspaceDir, format);
    }
  } catch (e) {
    if (e instanceof PluginsConfigError || e instanceof PluginsLockError) {
      process.stderr.write(`plugins ${sub}: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
