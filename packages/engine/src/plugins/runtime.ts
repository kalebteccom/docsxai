// Plugin runtime — resolves the configured plugin set once per CLI invocation.
//
// This module is the orchestration barrel: it composes the two halves of the pipeline and
// re-exports their public surface. The split keeps the deterministic, code-free planning half
// (./plan.ts) apart from the impure load half (./load.ts), which is the SOLE place plugin code
// is imported and register() runs.
//
// Pipeline:
//   1. Resolve each source ({package} via Node resolution, {path} realpath'd) to a manifest.  ┐
//   2. Reject api-version-incompatible manifests (load-error, precise message).               │
//   3. Verify plugins-lock.json sha256 of the register-module bytes BEFORE importing.         │ plan.ts
//   4. Namespace conflicts: every claimant of a contested namespace is disabled.              │
//   5. dependsOn presence + version-range checks (fixpoint — a disabled dep disables deps).   │
//   6. Tarjan-SCC cycle rejection: a cycle is refused as a unit, never partially loaded.      ┘
//   7. Capability subset check against the operator-enabled set (disables, not fatal).        ┐ load.ts
//   8. Import each register module in topological order; call register(api) exactly once.     ┘
//
// Plugins are in-process Node modules — NOT sandboxed. Trust is a review signal, not a boundary.
// A register() failure rolls back that plugin's artifacts and lands as a load-error status.

import type { PluginRegistry } from "./registry.js";
import { planPlugins, type ResolvePluginsOptions } from "./plan.js";
import { loadPlugins } from "./load.js";

export type {
  PluginSourceResolution,
  ResolvedPluginSource,
  ResolvePluginsOptions,
} from "./plan.js";
export { resolvePluginSources } from "./plan.js";
export type { PluginRegisterApi } from "./load.js";

/** Resolve, verify, and load the configured plugins. Every failure is a status, never a throw. */
export async function resolvePlugins(opts: ResolvePluginsOptions): Promise<PluginRegistry> {
  const plan = await planPlugins(opts);
  return loadPlugins(opts, plan);
}
