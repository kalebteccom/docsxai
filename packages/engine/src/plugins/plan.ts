// Plugin planning — the deterministic, code-free half of the runtime pipeline.
//
// Resolves every configured source to a validated manifest, then runs the ordering/rejection
// stages purely over manifest metadata — NEVER importing or executing plugin code:
//   1. Resolve each source ({package} via Node resolution, {path} realpath'd) to a manifest.
//   2. Reject api-version-incompatible manifests (load-error, precise message).
//   3. Verify plugins-lock.json sha256 of the register-module bytes BEFORE the load half imports.
//   4. Namespace conflicts: every claimant of a contested namespace is disabled (deterministic).
//   5. dependsOn presence + version-range checks (fixpoint — a disabled dep disables dependents).
//   6. Tarjan-SCC cycle rejection: a cycle is refused as a unit, never partially loaded.
//
// The output is a plan: the disabled records, plus the surviving candidates in topological load
// order. The capability subset check and the actual import + register() live in the load half,
// so `docsxai plugins sync` pins hashes through `resolvePluginSources` without executing anything.

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import {
  isApiVersionCompatible,
  parsePluginManifest,
  type PluginManifest,
  RUNTIME_API_VERSION,
  satisfiesRange,
} from "./manifest.js";
import { type PluginsLockFile, type PluginSourceSpec, verifyLock } from "./lock.js";
import type { PluginRecord } from "./registry.js";

/** A source whose package.json#docsxai validated. Not yet loaded. */
export interface ResolvedPluginSource {
  name: string;
  version: string;
  dir: string;
  registerPath: string;
  source: string;
  manifest: PluginManifest;
}

export type PluginSourceResolution =
  | { ok: true; candidate: ResolvedPluginSource }
  | { ok: false; record: PluginRecord };

export interface ResolvePluginsOptions {
  /** The workspace all plugin file IO is contained to. */
  workspaceDir: string;
  sources: ReadonlyArray<PluginSourceSpec>;
  /** Operator-enabled capabilities (exact-string subset check). Default: none enabled. */
  enabledCapabilities?: ReadonlyArray<string>;
  /** Parsed plugins-lock.json. When present, register-module bytes are verified before import. */
  lock?: PluginsLockFile | null;
}

/** The deterministic output of planning: disabled records, plus survivors in load order. */
export interface PluginPlan {
  /** Records for every rejected/disabled source — committed before any plugin loads. */
  disabled: PluginRecord[];
  /** Surviving candidates keyed by package name, used by the load half. */
  live: Map<string, ResolvedPluginSource>;
  /** Topological order (dependencies before dependents) over `live`. */
  loadOrder: string[];
}

function sourceLabel(spec: PluginSourceSpec): string {
  return "package" in spec ? `package:${spec.package}` : `path:${spec.path}`;
}

function failureRecord(name: string, source: string, reason: string): PluginRecord {
  return {
    name,
    version: "0.0.0",
    namespace: "",
    source,
    trust: "local",
    status: "load-error",
    statusReason: reason,
    artifacts: [],
  };
}

/** Build the PluginRecord for a resolved candidate at a given status. Shared with the load half. */
export function candidateRecord(
  c: ResolvedPluginSource,
  status: PluginRecord["status"],
  reason?: string,
): PluginRecord {
  return {
    name: c.name,
    version: c.version,
    namespace: c.manifest.namespace,
    source: c.source,
    trust: c.manifest.trust,
    status,
    ...(reason ? { statusReason: reason } : {}),
    manifest: c.manifest,
    registerPath: c.registerPath,
    artifacts: [],
  };
}

/**
 * Stage 1 only: resolve every source to a validated manifest (or a load-error record). Never
 * imports plugin code — `docsxai plugins sync` pins hashes through this without executing
 * anything.
 */
export async function resolvePluginSources(
  workspaceDir: string,
  sources: ReadonlyArray<PluginSourceSpec>,
): Promise<PluginSourceResolution[]> {
  const require = createRequire(import.meta.url);
  const out: PluginSourceResolution[] = [];
  for (const spec of sources) {
    const label = sourceLabel(spec);
    let pkgJsonPath: string;
    if ("package" in spec) {
      try {
        pkgJsonPath = require.resolve(`${spec.package}/package.json`);
      } catch (e) {
        out.push({
          ok: false,
          record: failureRecord(
            spec.package,
            label,
            `cannot resolve package "${spec.package}" — is it installed? (${(e as Error).message})`,
          ),
        });
        continue;
      }
    } else {
      const abs = path.resolve(workspaceDir, spec.path);
      let real: string;
      try {
        real = await fs.realpath(abs);
      } catch {
        out.push({
          ok: false,
          record: failureRecord(spec.path, label, `plugin path does not exist: ${abs}`),
        });
        continue;
      }
      pkgJsonPath = path.join(real, "package.json");
    }

    let pkg: { name?: unknown; version?: unknown; docsxai?: unknown };
    try {
      pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as typeof pkg;
    } catch (e) {
      out.push({
        ok: false,
        record: failureRecord(label, label, `cannot read ${pkgJsonPath}: ${(e as Error).message}`),
      });
      continue;
    }
    const name = typeof pkg.name === "string" && pkg.name ? pkg.name : label;
    const version = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
    let manifest: PluginManifest;
    try {
      manifest = parsePluginManifest(pkg.docsxai, name);
    } catch (e) {
      out.push({ ok: false, record: failureRecord(name, label, (e as Error).message) });
      continue;
    }
    const dir = path.dirname(pkgJsonPath);
    out.push({
      ok: true,
      candidate: {
        name,
        version,
        dir,
        registerPath: path.resolve(dir, manifest.register),
        source: label,
        manifest,
      },
    });
  }
  return out;
}

/** Tarjan strongly-connected components. Returns SCCs in reverse topological order. */
function tarjanSccs(nodes: ReadonlyArray<string>, edges: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  function strongconnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      sccs.push(scc);
    }
  }

  for (const v of nodes) if (!index.has(v)) strongconnect(v);
  return sccs;
}

/**
 * Run the deterministic planning pipeline (stages 1–6) over the configured sources. Never imports
 * plugin code; the surviving `loadOrder` is consumed by the load half, which performs the
 * capability subset check and the actual import + register().
 */
export async function planPlugins(opts: ResolvePluginsOptions): Promise<PluginPlan> {
  const resolutions = await resolvePluginSources(opts.workspaceDir, opts.sources);

  const disabled: PluginRecord[] = [];
  for (const r of resolutions) if (!r.ok) disabled.push(r.record);

  let candidates = resolutions.filter((r) => r.ok).map((r) => r.candidate);

  // Duplicate package names break dep-graph identity — refuse both, deterministically.
  const byName = new Map<string, ResolvedPluginSource[]>();
  for (const c of candidates) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  for (const [name, group] of byName) {
    if (group.length > 1) {
      for (const c of group) {
        disabled.push(
          candidateRecord(
            c,
            "load-error",
            `plugin package "${name}" is configured more than once (${group.map((g) => g.source).join(", ")}) — remove the duplicate`,
          ),
        );
      }
    }
  }
  candidates = candidates.filter((c) => byName.get(c.name)!.length === 1);

  // apiVersion compatibility.
  candidates = candidates.filter((c) => {
    if (isApiVersionCompatible(c.manifest.apiVersion)) return true;
    disabled.push(
      candidateRecord(
        c,
        "load-error",
        `plugin apiVersion "${c.manifest.apiVersion}" is incompatible with the runtime apiVersion "${RUNTIME_API_VERSION}" ` +
          `(requires same major and minor ≤ runtime) — upgrade the plugin or the engine`,
      ),
    );
    return false;
  });

  // Lock verification — BEFORE any import, so unverified bytes never execute.
  if (opts.lock) {
    const lock = opts.lock;
    const verified: ResolvedPluginSource[] = [];
    for (const c of candidates) {
      let bytes: Uint8Array | null;
      try {
        bytes = await fs.readFile(c.registerPath);
      } catch {
        bytes = null;
      }
      const mismatch = verifyLock(lock, c.manifest.namespace, bytes);
      if (mismatch) disabled.push(candidateRecord(c, "load-error", mismatch));
      else verified.push(c);
    }
    candidates = verified;
  }

  // Namespace conflicts: every claimant disabled — load order must not pick winners.
  const byNamespace = new Map<string, ResolvedPluginSource[]>();
  for (const c of candidates) {
    byNamespace.set(c.manifest.namespace, [...(byNamespace.get(c.manifest.namespace) ?? []), c]);
  }
  for (const [ns, group] of byNamespace) {
    if (group.length > 1) {
      for (const c of group) {
        disabled.push(
          candidateRecord(
            c,
            "disabled-by-namespace-conflict",
            `namespace "${ns}" is claimed by ${group.map((g) => `"${g.name}"`).join(" and ")} — namespaces must be unique; rename one`,
          ),
        );
      }
    }
  }
  candidates = candidates.filter((c) => byNamespace.get(c.manifest.namespace)!.length === 1);

  // dependsOn presence + version-range fixpoint: a disabled dep disables its dependents too.
  const live = new Map<string, ResolvedPluginSource>(candidates.map((c) => [c.name, c]));
  const dropForDeps = (): boolean => {
    let changed = false;
    for (const c of [...live.values()]) {
      for (const dep of c.manifest.dependsOn) {
        const target = live.get(dep.plugin);
        let reason: string | undefined;
        if (!target) {
          reason = `dependsOn "${dep.plugin}" is not loadable — configure it in the workspace "plugins" and ensure it resolves`;
        } else if (!satisfiesRange(target.version, dep.version)) {
          reason = `dependsOn "${dep.plugin}" version ${target.version} does not satisfy the declared range "${dep.version}"`;
        }
        if (reason) {
          disabled.push(candidateRecord(c, "disabled-by-dep-missing", reason));
          live.delete(c.name);
          changed = true;
          break;
        }
      }
    }
    return changed;
  };
  while (dropForDeps()) {
    /* fixpoint */
  }

  // Tarjan-SCC cycle rejection: refuse every member of a cycle as a unit.
  const edges = new Map<string, string[]>();
  for (const c of live.values()) {
    edges.set(
      c.name,
      c.manifest.dependsOn.map((d) => d.plugin).filter((n) => live.has(n)),
    );
  }
  const sccs = tarjanSccs([...live.keys()], edges);
  for (const scc of sccs) {
    const selfLoop = scc.length === 1 && (edges.get(scc[0]!) ?? []).includes(scc[0]!);
    if (scc.length > 1 || selfLoop) {
      const cycle = [...scc].sort();
      for (const name of scc) {
        disabled.push(
          candidateRecord(
            live.get(name)!,
            "disabled-by-cycle",
            `dependsOn cycle: ${cycle.join(" → ")} → ${cycle[0]!} — break the cycle; none of its members load`,
          ),
        );
        live.delete(name);
      }
    }
  }
  while (dropForDeps()) {
    /* dependents of cycle members are now dep-missing */
  }

  // Tarjan emits SCCs in reverse topological order; for a DAG that IS the load order
  // (dependencies before dependents).
  const loadOrder = sccs.map((scc) => scc[0]!).filter((name) => live.has(name));

  return { disabled, live, loadOrder };
}
