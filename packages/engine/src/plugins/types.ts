// Extension-point contracts for the plugin runtime. Publishers, renderers, lint-rules, and
// auth-strategies code against these shapes; the runtime auto-prefixes registered names with
// the plugin's namespace (`<ns>:<name>`).

import type { LintRule } from "../flow-lint.js";

/** Plugin-scoped logger. Writes to stderr prefixed `[plugin:<ns>]` — stdout stays clean for CLI output. */
export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PublisherContext {
  workspaceDir: string;
  projection: unknown;
  artifactsDir: string;
  config: Record<string, unknown>;
  secretsEnv: Record<string, string>;
  log: PluginLogger;
}

export interface PublishResult {
  ok: boolean;
  target: string;
  /** `section` echoes the projection section a page belongs to, so callers can rebuild their `{ section → pageId }` map from the result. */
  pages: Array<{
    id: string;
    url?: string;
    action: "created" | "updated" | "unchanged";
    section?: string;
  }>;
  warnings: string[];
}

export interface PublisherPlugin {
  publish(ctx: PublisherContext): Promise<PublishResult>;
}

export interface RendererContext {
  workspaceDir: string;
  outDir: string;
  flows: string[];
  config: Record<string, unknown>;
  log: PluginLogger;
}

export interface RendererResult {
  ok: boolean;
  outputs: string[];
  warnings: string[];
}

export interface RendererPlugin {
  render(ctx: RendererContext): Promise<RendererResult>;
}

export interface AuthStrategyPlugin {
  authenticate(ctx: {
    creds: Record<string, string>;
    options: Record<string, unknown>;
    baseURL: string;
    workspaceDir: string;
  }): Promise<{
    storageState: unknown;
    expiresAt?: string;
    contextOptions?: Record<string, unknown>;
  }>;
}

// The lint extension point is flow-lint's own injectable rule type — plugins register
// rules that run after the built-ins through `lintFlow`'s `extraRules`.
export type PluginLintRule = LintRule;
