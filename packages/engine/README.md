# @kalebtec/docsxai-engine

LLM-agnostic engine: flow-file parser + runtime, calibration helpers, target-site auth strategies, and the full `site-docs` CLI.

The engine **never** calls a model API. Calibration-time inference is supplied by the host agent (Claude Code, Codex, anything that speaks MCP) through the plugin's skill surface; execution is deterministic and replays a doc pack through headless Playwright.

## Surface

- **Flow-file** — declarative YAML at `<workspace>/flows/<name>.flow.yaml`: `prerequisites` + `locators` + `steps[]` (`action`, `target`, `wait_for`, `success`, `annotation` / `annotations`). Hand-editable; schema-validated. `extends:` composition for shared preambles.
- **`BrowserDriver`** interface — what the runtime needs from a browser. The `PlaywrightDriver` implementation includes the `actionable()` predicate (see [`docs/actionability-contract.md`](../../docs/actionability-contract.md)) that browser-bridge consumers can mirror.
- **Auth strategies** — `auth/strategy.yaml` descriptor + the `manual-capture` strategy (security-lowered instrumented Chrome → human logs in → `storageState` cached locally with the real auth-cookie's expiry tracked). Other strategies (API-direct, JWT-injection, etc.) are interface-accommodated.
- **CLI** — `site-docs <command>`. See `--help` or the [top-level README](../../README.md) for the full surface; this package's `dist/cli.js` is the binary.

## CLI commands

```
init           scaffold a workspace
capture-auth   cache an authed session
calibrate      extract a flow-file from a structured guide
inspect        discover [data-testid] locators on the live page
run            execute flows headless; emit annotations + screenshots
render         build the static viewer (shells out to @kalebtec/docsxai-viewer)
lint           static checks across flow-files (R001-R004)
flow-tree      visualise the `extends` graph
diagnose       halt-context + recommendations after a halt
style          init/validate style.yaml; --check scans for jargon leaks
zip            package the doc pack for hand-off
```

`run` has a sub-3-second iteration mode for long-async flows: `--start-from <step-id> --cdp <endpoint>` skips every step before the target and attaches to an already-warm Chrome.

## Plugins

The engine hosts a workspace plugin runtime (v1) with four extension points: **publishers**, **renderers**, **lint-rules**, and **auth-strategies**. Plugins are normal npm packages: a `docsxai` field on `package.json` plus a module exporting `register(api)`. They run **in-process and unsandboxed** — `trust` is a review signal, not a boundary — and the no-model-API rule binds them exactly as it binds the engine.

### Manifest (`package.json#docsxai`)

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

- `apiVersion` — exact semver of the runtime contract the plugin codes against. Must share the engine's `RUNTIME_API_VERSION` major with minor ≤ the runtime's, or the plugin load-errors.
- `namespace` — mandatory, `/^[a-z][a-z0-9-]*$/`. Every registered artifact is exposed as `<namespace>:<name>` (the runtime prefixes; plugins pass bare names). Reserved: `site-docs`, `docsxai`, `core`, `plugins`. Two plugins claiming one namespace are **both** disabled.
- `kinds` — the extension points the plugin registers (≥1). Registering an undeclared kind throws and load-errors the plugin (capability-disclosure honesty).
- `capabilities` — `egress:<host-glob>` declarations, subset-checked against the workspace's `plugin_capabilities`. Mismatch disables the plugin (status, not fatal). Publisher plugins are the **only** wiki/VCS egress path in the engine.
- `dependsOn` — `{ plugin, version }` entries (package name + `^`/`~`/exact range). Load order is topological; cycles are rejected as a unit.

### `register(api)`

The register module exports a `register(api)` function (named or default). `api` exposes `namespace`, `declaredKinds`, `declaredCapabilities`, `registerPublisher(name, impl)`, `registerRenderer(name, impl)`, `registerLintRules(name, rules)`, `registerAuthStrategy(name, impl)`, a stderr logger (`api.log`, prefixed `[plugin:<ns>]`), and `api.workspacePath(...segments)` — the only filesystem root a plugin may touch (escape attempts throw). The extension-point contracts (`PublisherPlugin`, `RendererPlugin`, `AuthStrategyPlugin`, `PluginLintRule`) are exported from this package.

### Workspace config + lock

Two optional `.site-docs.json` keys wire plugins into a workspace:

```json
{
  "plugins": [
    { "package": "@kalebtec/docsxai-plugin-confluence" },
    { "path": "../my-local-plugin" }
  ],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

`plugins-lock.json` (schema `site-docs/plugins-lock@1`, next to the config) pins each plugin's register-module sha256. When it exists, every resolve verifies the bytes **before** importing; a mismatch fails closed with a "run `site-docs plugins sync`" message.

### CLI

```
site-docs plugins list <workspace>             status table (loaded / disabled reasons); exit 1 if any plugin isn't loaded
site-docs plugins info <workspace> <namespace> manifest + registered artifact names
site-docs plugins sync <workspace>             (re)write plugins-lock.json — never executes plugin code
```

All three accept `--format json`. Plugins are resolved once per CLI invocation — there is no hot reload. See `docs/ai-context/plugin-runtime/lifecycle-and-namespacing.md` for the full lifecycle contract.

## License

[Apache-2.0](../../LICENSE).
