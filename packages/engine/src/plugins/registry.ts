// The composed plugin surface a CLI invocation consumes. The runtime resolves + loads plugins
// once and commits each one here; consumers retrieve artifacts by their namespace-qualified
// name (`<ns>:<name>`). All plugin file IO is chokepointed through `workspacePath`, which
// routes through `resolveWorkspacePath` against the workspace this registry was built for.

import { resolveWorkspacePath } from "../workspace.js";
import type { PluginKind, PluginManifest, PluginTrust } from "./manifest.js";
import type {
  AuthStrategyPlugin,
  PluginLintRule,
  PublisherPlugin,
  RendererPlugin,
} from "./types.js";

export type PluginStatus =
  | "loaded"
  | "disabled-by-capability-mismatch"
  | "disabled-by-cycle"
  | "disabled-by-dep-missing"
  | "disabled-by-namespace-conflict"
  | "load-error";

export interface PluginArtifact {
  kind: PluginKind;
  /** Namespace-qualified name, `<ns>:<name>`. */
  name: string;
}

export interface PluginRecord {
  /** Package name, or the source spec when the package never resolved. */
  name: string;
  version: string;
  /** Empty string when the manifest never validated. */
  namespace: string;
  /** `package:<npm-name>` or `path:<absolute-dir>`. */
  source: string;
  trust: PluginTrust;
  status: PluginStatus;
  statusReason?: string;
  manifest?: PluginManifest;
  /** Absolute path of the register module, when the manifest resolved. */
  registerPath?: string;
  artifacts: PluginArtifact[];
}

/** Artifacts a successfully-registered plugin contributes; committed atomically per plugin. */
export interface RegisteredArtifacts {
  publishers: ReadonlyMap<string, PublisherPlugin>;
  renderers: ReadonlyMap<string, RendererPlugin>;
  authStrategies: ReadonlyMap<string, AuthStrategyPlugin>;
  lintRules: ReadonlyArray<{ name: string; rules: ReadonlyArray<PluginLintRule> }>;
}

export class PluginRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginRegistryError";
  }
}

export class PluginRegistry {
  readonly workspaceDir: string;
  private readonly records: PluginRecord[] = [];
  private readonly publishers = new Map<string, PublisherPlugin>();
  private readonly renderers = new Map<string, RendererPlugin>();
  private readonly authStrategies = new Map<string, AuthStrategyPlugin>();
  private readonly lintRules: PluginLintRule[] = [];

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /** Workspace-contained path resolution — the only filesystem root plugins may touch. */
  workspacePath(...segments: string[]): string {
    return resolveWorkspacePath(this.workspaceDir, ...segments);
  }

  /** Runtime-facing: record a plugin's outcome (and, when loaded, its artifacts) atomically. */
  commit(record: PluginRecord, artifacts?: RegisteredArtifacts): void {
    this.records.push(record);
    if (!artifacts) return;
    for (const [name, impl] of artifacts.publishers) this.publishers.set(name, impl);
    for (const [name, impl] of artifacts.renderers) this.renderers.set(name, impl);
    for (const [name, impl] of artifacts.authStrategies) this.authStrategies.set(name, impl);
    for (const set of artifacts.lintRules) this.lintRules.push(...set.rules);
  }

  /** Full status table, sorted by namespace (package name as fallback) for deterministic output. */
  listPlugins(): PluginRecord[] {
    return [...this.records].sort((a, b) =>
      (a.namespace || a.name).localeCompare(b.namespace || b.name),
    );
  }

  /** Manifest + registered artifact names for one plugin, looked up by namespace or package name. */
  pluginsInfo(name: string): PluginRecord | undefined {
    return (
      this.records.find((r) => r.namespace === name) ?? this.records.find((r) => r.name === name)
    );
  }

  getPublisher(qualifiedName: string): PublisherPlugin {
    const impl = this.publishers.get(qualifiedName);
    if (!impl) throw this.unknownArtifact("publisher", qualifiedName, this.publishers.keys());
    return impl;
  }

  getRenderer(qualifiedName: string): RendererPlugin {
    const impl = this.renderers.get(qualifiedName);
    if (!impl) throw this.unknownArtifact("renderer", qualifiedName, this.renderers.keys());
    return impl;
  }

  getAuthStrategies(): Map<string, AuthStrategyPlugin> {
    return new Map(this.authStrategies);
  }

  getLintRules(): PluginLintRule[] {
    return [...this.lintRules];
  }

  private unknownArtifact(
    kind: string,
    qualifiedName: string,
    known: Iterable<string>,
  ): PluginRegistryError {
    const names = [...known].sort();
    return new PluginRegistryError(
      `no ${kind} named "${qualifiedName}" is registered` +
        (names.length ? ` (registered: ${names.join(", ")})` : " (no plugins registered one)"),
    );
  }
}
