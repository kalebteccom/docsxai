// Plugin loading — the impure half of the runtime pipeline, and the SOLE place plugin code runs.
//
// Given a plan (survivors in topological order), this:
//   7. Capability subset check against the operator-enabled set (disables, not fatal).
//   8. Import each register module in topological order; call register(api) exactly once.
//
// Plugins are in-process Node modules — NOT sandboxed. Trust is a review signal, not a boundary.
// A register() failure rolls back that plugin's artifacts and lands as a load-error status.
// This is the only module that dynamically imports plugin modules and invokes register().

import { pathToFileURL } from "node:url";
import { resolveWorkspacePath } from "../workspace.js";
import type { PluginKind } from "./manifest.js";
import { PluginRegistry, type PluginRecord, type RegisteredArtifacts } from "./registry.js";
import type {
  AuthStrategyPlugin,
  PluginLintRule,
  PluginLogger,
  PublisherPlugin,
  RendererPlugin,
} from "./types.js";
import { candidateRecord, type PluginPlan, type ResolvePluginsOptions } from "./plan.js";

/** What a plugin's `register(api)` receives. Registered names are auto-prefixed `<ns>:<name>`. */
export interface PluginRegisterApi {
  readonly namespace: string;
  readonly declaredKinds: ReadonlyArray<PluginKind>;
  readonly declaredCapabilities: ReadonlyArray<string>;
  registerPublisher(name: string, impl: PublisherPlugin): void;
  registerRenderer(name: string, impl: RendererPlugin): void;
  registerLintRules(name: string, rules: PluginLintRule[]): void;
  registerAuthStrategy(name: string, impl: AuthStrategyPlugin): void;
  readonly log: PluginLogger;
  /** Workspace-contained path resolution — the only filesystem root a plugin may write under. */
  workspacePath(...segments: string[]): string;
}

/**
 * Commit the plan's disabled records, then import + register the surviving plugins in load order.
 * Every failure is a status, never a throw. This is the only place plugin code is imported.
 */
export async function loadPlugins(
  opts: ResolvePluginsOptions,
  plan: PluginPlan,
): Promise<PluginRegistry> {
  const registry = new PluginRegistry(opts.workspaceDir);
  const enabled = new Set(opts.enabledCapabilities ?? []);
  const { disabled, live, loadOrder } = plan;

  for (const record of disabled) registry.commit(record);

  for (const name of loadOrder) {
    const c = live.get(name)!;

    const missing = c.manifest.capabilities.filter((cap) => !enabled.has(cap));
    if (missing.length > 0) {
      registry.commit(
        candidateRecord(
          c,
          "disabled-by-capability-mismatch",
          `plugin declares capabilities [${missing.join(", ")}] not enabled for this workspace — ` +
            `add them to "plugin_capabilities" in .docsxai.json to opt in`,
        ),
      );
      continue;
    }

    const ns = c.manifest.namespace;
    const publishers = new Map<string, PublisherPlugin>();
    const renderers = new Map<string, RendererPlugin>();
    const authStrategies = new Map<string, AuthStrategyPlugin>();
    const lintRules: Array<{ name: string; rules: PluginLintRule[] }> = [];
    const artifacts: PluginRecord["artifacts"] = [];

    const ARTIFACT_NAME = /^[a-z][a-z0-9-]*$/;
    const qualify = (kind: PluginKind, bare: string, taken: { has(k: string): boolean }) => {
      if (!c.manifest.kinds.includes(kind)) {
        throw new Error(
          `plugin "${c.name}": registered a "${kind}" but the manifest's kinds are [${c.manifest.kinds.join(", ")}] — declare every extension point the plugin registers`,
        );
      }
      if (!ARTIFACT_NAME.test(bare)) {
        throw new Error(
          `plugin "${c.name}": artifact name "${bare}" must be bare kebab-case (the runtime prefixes "${ns}:")`,
        );
      }
      const qualified = `${ns}:${bare}`;
      if (taken.has(qualified)) {
        throw new Error(`plugin "${c.name}": ${kind} "${qualified}" is already registered`);
      }
      artifacts.push({ kind, name: qualified });
      return qualified;
    };

    const log: PluginLogger = {
      info: (message) => process.stderr.write(`[plugin:${ns}] ${message}\n`),
      warn: (message) => process.stderr.write(`[plugin:${ns}] warn: ${message}\n`),
      error: (message) => process.stderr.write(`[plugin:${ns}] error: ${message}\n`),
    };

    const lintRuleNames = new Set<string>();
    const api: PluginRegisterApi = {
      namespace: ns,
      declaredKinds: c.manifest.kinds,
      declaredCapabilities: c.manifest.capabilities,
      registerPublisher: (bare, impl) => {
        publishers.set(qualify("publisher", bare, publishers), impl);
      },
      registerRenderer: (bare, impl) => {
        renderers.set(qualify("renderer", bare, renderers), impl);
      },
      registerLintRules: (bare, rules) => {
        const qualified = qualify("lint-rules", bare, lintRuleNames);
        lintRuleNames.add(qualified);
        lintRules.push({ name: qualified, rules: [...rules] });
      },
      registerAuthStrategy: (bare, impl) => {
        authStrategies.set(qualify("auth-strategy", bare, authStrategies), impl);
      },
      log,
      workspacePath: (...segments) => resolveWorkspacePath(opts.workspaceDir, ...segments),
    };

    try {
      const mod = (await import(pathToFileURL(c.registerPath).href)) as {
        register?: unknown;
        default?: unknown;
      };
      const fn = mod.register ?? mod.default;
      if (typeof fn !== "function") {
        throw new Error(
          `register module ${c.registerPath} must export a register(api) function (named or default)`,
        );
      }
      await (fn as (api: PluginRegisterApi) => unknown)(api);
    } catch (e) {
      // Roll back: nothing this plugin registered survives a failed register().
      registry.commit(
        candidateRecord(
          c,
          "load-error",
          `register() failed for plugin "${c.name}": ${(e as Error).message}`,
        ),
      );
      continue;
    }

    const record = candidateRecord(c, "loaded");
    record.artifacts = artifacts;
    const committed: RegisteredArtifacts = { publishers, renderers, authStrategies, lintRules };
    registry.commit(record, committed);
  }

  return registry;
}
