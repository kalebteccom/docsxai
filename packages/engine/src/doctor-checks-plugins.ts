// docsxai doctor - the plugin-runtime probe. Split out of doctor-checks.ts: the
// plugin config / lock / manifest checking is a distinct, sizeable concern from
// the environment and workspace-content probes, with its own dependency set
// (the plugin runtime + lock + manifest domain).

import { promises as fs } from "node:fs";
import { isApiVersionCompatible, RUNTIME_API_VERSION } from "./plugins/manifest.js";
import {
  PLUGINS_LOCK_FILE,
  PluginsConfigError,
  PluginsLockError,
  readPluginsLock,
  readWorkspacePluginsConfig,
  verifyLock,
} from "./plugins/lock.js";
import { resolvePluginSources } from "./plugins/runtime.js";
import { WORKSPACE_CONFIG_FILE } from "./workspace.js";
import type { DoctorCheck } from "./doctor-checks.js";

export async function checkPlugins(workspaceDir: string): Promise<DoctorCheck[]> {
  let cfg;
  try {
    cfg = await readWorkspacePluginsConfig(workspaceDir);
  } catch (e) {
    if (e instanceof PluginsConfigError) {
      return [
        {
          name: "plugins",
          ok: false,
          detail: e.message,
          fix: `fix the "plugins" / "plugin_capabilities" keys in ${WORKSPACE_CONFIG_FILE}`,
        },
      ];
    }
    throw e;
  }
  if (cfg.sources.length === 0) {
    return [
      {
        name: "plugins",
        ok: true,
        info: true,
        detail: `no plugins configured (add a "plugins" array to ${WORKSPACE_CONFIG_FILE})`,
      },
    ];
  }
  let lock;
  try {
    lock = await readPluginsLock(workspaceDir);
  } catch (e) {
    if (e instanceof PluginsLockError) {
      return [
        {
          name: "plugins",
          ok: false,
          detail: e.message,
          fix: `re-pin: docsxai plugins sync ${workspaceDir}`,
        },
      ];
    }
    throw e;
  }

  const checks: DoctorCheck[] = [];
  if (!lock) {
    checks.push({
      name: "plugins",
      ok: false,
      detail: `${PLUGINS_LOCK_FILE} missing (${cfg.sources.length} plugin(s) configured — no reproducibility pin)`,
      fix: `docsxai plugins sync ${workspaceDir}`,
    });
  }

  const resolutions = await resolvePluginSources(workspaceDir, cfg.sources);
  const enabled = new Set(cfg.capabilities);
  const namespaceOwner = new Map<string, string>();
  for (const r of resolutions) {
    if (!r.ok) {
      checks.push({
        name: "plugins",
        ok: false,
        detail: `${r.record.name}: ${r.record.statusReason ?? "unresolvable"}`,
        fix: `fix the source entry in ${WORKSPACE_CONFIG_FILE} (or install the package), then \`docsxai plugins sync\``,
      });
      continue;
    }
    const c = r.candidate;
    const ns = c.manifest.namespace;
    const issues: Array<{ detail: string; fix: string }> = [];

    if (!isApiVersionCompatible(c.manifest.apiVersion)) {
      issues.push({
        detail: `${c.name} apiVersion "${c.manifest.apiVersion}" incompatible with runtime apiVersion "${RUNTIME_API_VERSION}"`,
        fix: "upgrade the plugin or the engine (same major, plugin minor ≤ runtime)",
      });
    }
    const prior = namespaceOwner.get(ns);
    if (prior) {
      issues.push({
        detail: `${c.name} namespace "${ns}" already claimed by ${prior} — neither will load`,
        fix: "namespaces are unique across the configured set; rename one",
      });
    } else {
      namespaceOwner.set(ns, c.name);
    }
    let lockNote = "no lock";
    if (lock) {
      let bytes: Uint8Array | null;
      try {
        bytes = await fs.readFile(c.registerPath);
      } catch {
        bytes = null;
      }
      const mismatch = verifyLock(lock, ns, bytes);
      if (mismatch) {
        issues.push({
          detail: mismatch,
          fix: `after auditing the change: docsxai plugins sync ${workspaceDir}`,
        });
      } else {
        lockNote = "lock ok";
      }
    }
    const missingCaps = c.manifest.capabilities.filter((cap) => !enabled.has(cap));
    if (missingCaps.length > 0) {
      issues.push({
        detail: `${c.name} declares capability(ies) [${missingCaps.join(", ")}] not enabled for this workspace`,
        fix: `opt in via "plugin_capabilities" in ${WORKSPACE_CONFIG_FILE}`,
      });
    }

    if (issues.length > 0) {
      for (const i of issues) checks.push({ name: "plugins", ok: false, ...i });
    } else {
      checks.push({
        name: "plugins",
        ok: true,
        detail: `${c.name}@${c.version} (ns=${ns}, ${c.manifest.kinds.join(",")}, ${lockNote})`,
      });
    }
  }
  return checks;
}
