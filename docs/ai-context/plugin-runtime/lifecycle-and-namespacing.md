# Plugin runtime — lifecycle and namespacing

docsxai ships a workspace plugin runtime so external packages can extend the engine without touching the core. The extension points are **publishers** (push a doc-pack projection to a wiki/VCS target), **renderers** (alternative output formats), **lint-rules** (extra flow-file checks), and **auth-strategies** (new ways to authenticate against the target site). The runtime guarantees: namespace isolation, capability disclosure, `dependsOn` resolution with cycle rejection, lock-verified module bytes, and workspace-path containment.

The shape deliberately mirrors browxai's proven v1 plugin runtime (manifest in `package.json`, `register(api)`, resolved-once lifecycle, status table). Where docsxai differs, this page is the contract.

## Lifecycle — resolved once at startup

Plugins are **resolved once per CLI invocation**, never lazily mid-run. docsxai is a CLI, not a daemon: "startup" is the moment a command that consumes plugins constructs the registry (`resolvePlugins(...)`).

1. The command reads the workspace config (`.docsxai.json` → `plugins`, `plugin_capabilities`).
2. Each source is resolved to a manifest: `{ package }` via Node module resolution, `{ path }` via realpath'd filesystem path.
3. If `plugins-lock.json` exists next to the workspace config, every plugin's register-module bytes are sha256-verified **before** import. Mismatch → that plugin load-errors with a "lock mismatch — run `docsxai plugins sync`" message.
4. The runtime validates namespaces, api versions, `dependsOn` targets + version ranges, and capability declarations.
5. The dep graph is topo-sorted; Tarjan-SCC cycle detection rejects every plugin in a cycle (`disabled-by-cycle`) — a cycle is never partially loaded.
6. For each remaining plugin, in topological order: the register module is dynamically imported and `register(api)` is called exactly once.

A plugin error during `register()` is **fatal for that invocation's use of the plugin**: the plugin lands in the status table as `load-error` with a structured reason naming the plugin, any artifacts it registered before the failure are rolled back, and a command that requires the plugin fails loudly (`docsxai plugins list` exits non-zero when any configured plugin is not `loaded`). Plugins do not have a "running but degraded" mode.

There is no hot reload. Editing a plugin's source mid-invocation has no effect; the next invocation resolves the world afresh.

## Statuses

Every configured plugin resolves to exactly one status:

| Status                            | Meaning                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `loaded`                          | Manifest valid, lock verified, `register(api)` completed.                                                                |
| `disabled-by-capability-mismatch` | Declares a capability the operator hasn't enabled. Not fatal — the plugin is skipped with a reason.                      |
| `disabled-by-cycle`               | Member of a `dependsOn` cycle. The whole strongly-connected component is rejected.                                       |
| `disabled-by-dep-missing`         | A `dependsOn` target isn't configured, failed to resolve, or its version doesn't satisfy the declared range.             |
| `disabled-by-namespace-conflict`  | Two plugins claim the same namespace. **Both** are conflict-disabled (deterministic — load order must not pick winners). |
| `load-error`                      | Manifest invalid, api-version incompatible, lock mismatch, unresolvable source, or `register()` threw.                   |

An api-version mismatch is a `load-error` with a precise message naming both versions: a plugin's `apiVersion` must share the runtime's major and have a minor ≤ the runtime's (`RUNTIME_API_VERSION`, currently `1.0.0`).

## Namespacing

Every plugin declares a mandatory `namespace` (`/^[a-z][a-z0-9-]*$/`, kebab-case). Every artifact the plugin registers is exposed as `<namespace>:<name>` — the runtime applies the prefix; plugins pass bare names. Reserved namespaces: `docsxai`, `site-docs`, `core`, `plugins`. Claiming one is a manifest-validation failure. (`site-docs` is the pre-rename product name, kept reserved defensively so no plugin can squat the old identity.)

Mandatory prefixing means an artifact name alone tells you which plugin owns it, and a plugin can never shadow a built-in or another plugin's artifact.

## Capability declarations

A plugin declares the capabilities its artifacts need in the manifest — today the only capability family is `egress:<host-glob>` (e.g. `egress:*.atlassian.net`); unknown prefixes are rejected at manifest validation. The declared set is subset-checked (exact string match) against the operator-enabled set (`plugin_capabilities` in `.docsxai.json`). A mismatch disables the plugin with `disabled-by-capability-mismatch` — a status, not a fatal error.

This is how the egress boundary stays auditable: the engine core's only outbound HTTP path is the backend client; wiki/VCS egress lives exclusively in capability-declared publisher plugins. A publisher that talks to `*.atlassian.net` must say so in its manifest, and the operator must have opted in.

Capability honesty is enforced at registration too: calling a `register*` function for a kind not in the manifest's `kinds` throws — capability-disclosure honesty is load-bearing — and that plugin load-errors.

## dependsOn + load order

`dependsOn` entries are `{ plugin: <package-name>, version: <range> }`. The runtime checks the target resolved and that its manifest version satisfies the range (minimal semver: `^x.y.z`, `~x.y.z`, exact). Load order is topological; Tarjan-SCC cycle detection rejects cycles as a unit.

## Trust, sandboxing, and the no-model-API rule

Plugins are **in-process Node modules. They are NOT sandboxed.** A loaded plugin has full Node access. The `trust` field (`kalebtec` | `community` | `local`) is a **review signal**, not a security boundary — treat installing a plugin like adding an npm dependency. The runtime gates all three tiers identically.

`plugins-lock.json` pins the sha256 of each plugin's register-module bytes; resolution verifies the hash before importing, so a silently-swapped module fails closed. `docsxai plugins sync` (re)writes the lock.

Two engine contracts bind plugins exactly as they bind the core:

- **The no-model-API rule.** A publisher/renderer/lint-rules/auth-strategy plugin calling an LLM provider is a contract violation. Execution mode is deterministic and inference-free; plugins run inside execution mode.
- **Workspace containment.** All plugin file IO goes through `api.workspacePath(...)`, which routes through `resolveWorkspacePath` against the workspace the registry was constructed with. Escape attempts throw.

## Substrate vs. plugin responsibility

The substrate team MUST NOT reach into the engine to fix plugin-side breakage. If a publisher's target (Confluence, Notion, a VCS wiki) ships a change that breaks the plugin, the fix stays in the plugin. The substrate's job is to keep the plugin-runtime contract stable; the plugin's job is to track its target. This split is what makes the plugin model trustworthy.

## Related

- [`../../../packages/engine/README.md`](../../../packages/engine/README.md) — adopter-facing plugins surface (manifest example, extension points, CLI, lock).
- [`../architecture/surface-map.md`](../architecture/surface-map.md) — the load-bearing boundaries.
- [`../secrets-and-egress/README.md`](../secrets-and-egress/README.md) — egress chokepoints; publisher plugins are the only wiki/VCS egress path.
