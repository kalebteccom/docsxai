---
title: Writing plugins
description: Author a docsxai plugin end to end - the package.json manifest, the four extension-point contracts, the register(api) module, capability declarations, workspace wiring, and a complete minimal publisher.
---

The engine hosts a workspace plugin runtime with four extension points:
**publishers**, **renderers**, **lint-rules**, and **auth-strategies**. A
plugin is a normal npm package: a `docsxai` field on its `package.json` plus
a module exporting `register(api)`. This guide walks the authoring path; the
[plugins reference](/reference/plugins/) has the field-by-field manifest and
lock-file tables.

Two first-party plugins are worth cribbing from:
[plugin-confluence](/packages/plugin-confluence/) (a publisher) and
[plugin-starlight](/packages/plugin-starlight/) (a renderer).

## The manifest

The `docsxai` field on your `package.json` is the manifest. It is
Zod-validated; a malformed or lying manifest is a load error, and the plugin
never reaches `register()`:

```json
{
  "name": "@kalebtec/docsxai-plugin-confluence",
  "version": "0.1.0",
  "docsxai": {
    "apiVersion": "1.0.0",
    "namespace": "confluence",
    "register": "./dist/register.js",
    "kinds": ["publisher"],
    "capabilities": ["egress:*.atlassian.net"],
    "dependsOn": [],
    "trust": "kalebtec"
  }
}
```

`apiVersion` is the runtime contract version you code against: it must share
the engine runtime's major version with a minor at or below the runtime's. A
plugin built for `1.0.0` runs under runtime `1.5.0`; one built for `1.6.0` or
`2.0.0` does not.

## Namespacing

`namespace` is mandatory, kebab-case (`/^[a-z][a-z0-9-]*$/`). Every artifact
you register is exposed as `<namespace>:<name>` - the runtime adds the
prefix, you pass bare names. Four namespaces are reserved (`site-docs`,
`docsxai`, `core`, `plugins`), and if two plugins claim the same namespace,
**both** are disabled - load order never picks winners.

## Capabilities

The only capability family today is target-host egress:
`egress:<host-glob>`. Declare every host your plugin talks to; the runtime
subset-checks your declarations against the workspace's
`plugin_capabilities` and disables the plugin on a mismatch (a status, not a
crash). Unknown capability prefixes are rejected outright so a manifest
cannot smuggle an undisclosed capability past review. Publisher plugins are
the only wiki/VCS egress path in the engine - the engine core emits files and
payloads only.

## The four extension-point contracts

These are the exact contracts from the engine's plugin surface
(`PublisherPlugin`, `RendererPlugin`, `AuthStrategyPlugin`, `PluginLintRule`
are exported from `@kalebtec/docsxai-engine`):

```ts
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
```

A `LintRule` is `{ code, run(flow, opts) }` returning lint issues; the
built-ins use `RNNN` codes, so pick another prefix for yours.

## `register(api)`

Your `register` module exports a `register(api)` function (named or
default). The `api` object gives you:

- `namespace`, `declaredKinds`, `declaredCapabilities` - your own manifest,
  echoed back.
- `registerPublisher(name, impl)`, `registerRenderer(name, impl)`,
  `registerLintRules(name, rules)`, `registerAuthStrategy(name, impl)` - one
  per declared kind. Registering a kind you did not declare in `kinds` throws
  and load-errors the plugin: capability-disclosure honesty is enforced, not
  suggested.
- `api.log` - the stderr logger, prefixed `[plugin:<ns>]`.
- `api.workspacePath(...segments)` - the **only** filesystem root a plugin
  may touch. Escape attempts (absolute paths, `..` traversal) throw.

A `register()` failure rolls back that plugin's artifacts and lands as a
load-error status; the rest of the plugin set keeps working.

## A complete minimal publisher

```ts
// src/register.ts — a publisher that writes the projection to a JSON file.
import type { PublisherContext, PublishResult } from "@kalebtec/docsxai-engine";
import { writeFile } from "node:fs/promises";

export function register(api: {
  registerPublisher(name: string, impl: { publish(ctx: PublisherContext): Promise<PublishResult> }): void;
  workspacePath(...segments: string[]): string;
  log: { info(msg: string): void };
}): void {
  api.registerPublisher("file", {
    async publish(ctx) {
      const out = api.workspacePath(".export", "file-publish.json");
      await writeFile(out, JSON.stringify(ctx.projection, null, 2) + "\n", "utf8");
      api.log.info(`wrote ${out}`);
      return { ok: true, target: out, pages: [], warnings: [] };
    },
  });
}
```

With `"namespace": "demo"` and `"kinds": ["publisher"]` in the manifest, the
artifact is exposed as `demo:file`. No `capabilities` are needed - it makes
no network calls.

## Wiring a workspace

Two optional keys in the workspace's `.site-docs.json` activate plugins:

```json
{
  "plugins": [
    { "package": "@kalebtec/docsxai-plugin-confluence" },
    { "path": "../my-local-plugin" }
  ],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

Then pin and verify:

```sh
site-docs plugins sync <workspace>   # (re)write plugins-lock.json — never executes plugin code
site-docs plugins list <workspace>   # status table; exit 1 if any plugin is not loaded
```

`plugins-lock.json` pins the sha256 of each plugin's register-module bytes.
When the lock exists, every resolve verifies the bytes **before** importing;
a mismatch fails closed with a "run `site-docs plugins sync`" message. Treat
the lock like any other lockfile: commit it, and re-sync deliberately when
you upgrade a plugin.

## The honesty section

Two rules bind plugins exactly as they bind the engine:

- **No model APIs.** Plugins run inside the engine's process, and the
  engine-never-calls-models contract extends to everything loaded into it.
  A plugin that needs inference belongs on the calibration side, as host-agent
  tooling, not here.
- **No sandbox.** Plugins execute in-process and unsandboxed. The `trust`
  field (`kalebtec` / `community` / `local`) is a review signal, not a
  security boundary; the lock file protects against silent swaps, not against
  malicious code you chose to install. Read a plugin before you add it to a
  workspace, the same way you would read a CI action.
