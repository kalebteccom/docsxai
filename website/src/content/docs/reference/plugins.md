---
title: Plugins
description: The plugin runtime reference - the docsxai manifest field by field, the plugin status enum, the plugins-lock.json format, the plugins CLI, and the capability string grammar.
---

This is the runtime and manifest reference for workspace plugins. For the
authoring walkthrough (the extension-point TypeScript contracts, a complete
minimal publisher, `register(api)`), see
[Writing plugins](/guides/writing-plugins/).

Plugins extend the engine at four points - **publishers**, **renderers**,
**lint-rules**, and **auth-strategies** - and run in-process, unsandboxed,
under the same no-model-API contract as the engine itself.

## The manifest (`package.json#docsxai`)

| Field          | Type / shape                                                          | Rules                                                                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`   | exact semver string (`x.y.z`)                                         | Must share the runtime's major version with minor at or below the runtime's. A plugin built for `1.0.0` runs under runtime `1.5.0`; one built for `1.6.0` or `2.0.0` load-errors.                                                       |
| `namespace`    | kebab-case, `/^[a-z][a-z0-9-]*$/`                                     | Mandatory. Every registered artifact is exposed as `<namespace>:<name>` (the runtime prefixes; plugins pass bare names). Reserved: `site-docs`, `docsxai`, `core`, `plugins`. Two plugins claiming one namespace are **both** disabled. |
| `register`     | relative path string                                                  | The module exporting `register(api)` (named or default export).                                                                                                                                                                         |
| `kinds`        | array of `publisher` \| `renderer` \| `lint-rules` \| `auth-strategy` | At least one. Registering an undeclared kind throws and load-errors the plugin.                                                                                                                                                         |
| `capabilities` | array of capability strings (default `[]`)                            | Subset-checked against the workspace's `plugin_capabilities`; a mismatch disables the plugin.                                                                                                                                           |
| `dependsOn`    | array of `{ plugin, version }` (default `[]`)                         | Package name plus a `^x.y.z`, `~x.y.z`, or exact range. Load order is topological; cycles are rejected as a unit; a disabled dependency disables its dependents.                                                                        |
| `trust`        | `kalebtec` \| `community` \| `local` (default `local`)                | A review signal, not a sandbox boundary.                                                                                                                                                                                                |

A missing `docsxai` field means "not a plugin"; a malformed manifest is a
load error - the plugin never reaches `register()`.

## Capability strings

The only capability family today is target-host egress:

```
egress:<host-glob>        e.g. egress:*.atlassian.net
```

Globs allow `*` in host positions. Unknown capability prefixes are rejected
at manifest parse time, so a manifest cannot smuggle an undisclosed
capability past review. Publisher plugins are the only wiki/VCS egress path
in the engine.

## Plugin status

`site-docs plugins list` reports one status per configured plugin. Every
failure is a status, never a crash of the resolve:

| Status                            | Meaning                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `loaded`                          | Manifest valid, lock verified, `register()` succeeded.                                                              |
| `disabled-by-capability-mismatch` | Declared capabilities are not a subset of the workspace's `plugin_capabilities`.                                    |
| `disabled-by-cycle`               | The plugin participates in a `dependsOn` cycle (the whole cycle is disabled).                                       |
| `disabled-by-dep-missing`         | A `dependsOn` entry is absent, disabled, or fails its version range.                                                |
| `disabled-by-namespace-conflict`  | Another plugin claims the same namespace (both are disabled).                                                       |
| `load-error`                      | Malformed or incompatible manifest, lock mismatch, or `register()` threw (that plugin's artifacts are rolled back). |

A `statusReason` string accompanies every non-`loaded` status.

## Workspace wiring

Two optional `.site-docs.json` keys:

```json
{
  "plugins": [
    { "package": "@kalebtec/docsxai-plugin-confluence" },
    { "path": "../my-local-plugin" }
  ],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

A source is either `{ package }` (resolved through Node from the workspace)
or `{ path }` (a local directory). Plugins are resolved once per CLI
invocation; there is no hot reload.

## The lock file (`plugins-lock.json`)

Schema `site-docs/plugins-lock@1`, next to the workspace config:

```json
{
  "schema": "site-docs/plugins-lock@1",
  "plugins": {
    "@kalebtec/docsxai-plugin-confluence": {
      "source": "package:@kalebtec/docsxai-plugin-confluence",
      "version": "0.1.0",
      "sha256": "<hex sha256 of the register module's bytes>"
    }
  }
}
```

The lock pins the sha256 of each plugin's register-module file bytes. When
the file exists, every resolve verifies the bytes **before** importing; a
silently-swapped module fails closed with a "run `site-docs plugins sync`"
message. Commit the lock; re-sync deliberately when you upgrade a plugin.

## CLI

```
site-docs plugins list <workspace>               status table (loaded / disabled reasons); exit 1 if any plugin is not loaded
site-docs plugins info <workspace> <namespace>   manifest + registered artifact names
site-docs plugins sync <workspace>               (re)write plugins-lock.json - never executes plugin code
```

All three accept `--format json`.
