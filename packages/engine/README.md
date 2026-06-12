# @docsxai/engine

LLM-agnostic engine: flow-file parser + runtime, calibration helpers, target-site auth strategies, and the full `docsxai` CLI.

The engine **never** calls a model API. Calibration-time inference is supplied by the host agent (Claude Code, Codex, anything that speaks MCP) through the plugin's skill surface; execution is deterministic and replays a doc pack through headless Playwright.

## Surface

- **Flow-file** — declarative YAML at `<workspace>/flows/<name>.flow.yaml`: `prerequisites` + `locators` + `steps[]` (`action`, `target`, `wait_for`, `success`, `annotation` / `annotations`, per-step `redactions`). Hand-editable; schema-validated. `extends:` composition for shared preambles (with `environment` merged per-key, child wins; `redactions` concatenated).
- **Execution environment** — optional `environment` block (`EnvironmentSpec`): frozen `clock` (Playwright clock API), `locale`, `timezone`, `viewport` (`VIEWPORT_PRESETS`: desktop / tablet / mobile, or explicit size), `color_scheme`, `reduced_motion`. Applied at context creation by `launchPlaywrightSession({ environment })`; on CDP-attached sessions only the clock applies (one stderr warning lists skipped fields). `contextOptions` passes `httpCredentials` / `clientCertificates` / `extraHTTPHeaders` through to `browser.newContext`.
- **Redactions** — flow-level + per-step `RedactionSpec[]` (`{ selector }` or `{ region }`, style `box` | `pixelate`) masked deterministically before any screenshot (halt shots included) hits disk. The pure pixel transform is `applyRedactions` in `redact.ts`.
- **`BrowserDriver`** interface — what the runtime needs from a browser. The `PlaywrightDriver` implementation includes the `actionable()` predicate (see [`docs/actionability-contract.md`](../../docs/actionability-contract.md)) that browser-bridge consumers can mirror, plus a real `element_stable` wait (bounding-box polling, 10 s best-effort budget).
- **Auth strategies** — `auth/strategy.yaml` descriptor + a catalogue of scripted strategies (`api-login`, `ui-form` with a TOTP hop, `email-otp`, `webauthn`, `jwt-injection`, `http-basic`, `pat-header`, `mtls`, `test-backdoor`) alongside the human-in-the-loop `manual-capture`. See [Auth strategies](#auth-strategies) below.
- **CLI** — `docsxai <command>`. See `--help` or the [top-level README](../../README.md) for the full surface; this package's `dist/cli.js` is the binary.

## CLI commands

```
init           scaffold a workspace
capture-auth   cache an authed session
calibrate      extract a flow-file from a structured guide
inspect        discover [data-testid] locators on the live page
run            execute flows headless; emit annotations + screenshots
render         build the static viewer (spawns the @docsxai/viewer bin)
lint           static checks across flow-files (R001-R010; `extraRules` injectable via `lintFlow`)
flow-tree      visualise the `extends` graph
diagnose       halt-context + recommendations after a halt
style          init/validate style.yaml; --check scans for jargon leaks
zip            package the doc pack for hand-off
baseline       snapshot the doc pack (flows, prose, annotations, screenshots, locators) for drift comparison
diff           deterministic drift report against a baseline (--fail-on warn|fail gates CI)
export         project the doc pack to a publisher format (`export adf` — Confluence ADF; `export playwright` — Playwright specs)
```

`run` has a sub-3-second iteration mode for long-async flows: `--start-from <step-id> --cdp <endpoint>` skips every step before the target and attaches to an already-warm Chrome.

`zip` packages the doc pack in-process (via fflate) — no system `zip` binary required — and **deterministically**: entries are sorted, every entry's mtime is pinned to the zip epoch (1980-01-01), and the compression level is fixed, so the same doc pack always produces a byte-identical archive. Includes `flows/`, `docs/`, `.docsxai.json`, `auth/strategy.yaml`, `README.md`; excludes `.auth/`, `**/halts/`, and (unless `--include-viewer`) `.viewer/`. Symlinks that point outside the workspace are never followed into the archive.

`export adf` projects the doc pack to Confluence Cloud ADF (`projectDocPackToAdf` from the library surface) — pure and deterministic, zero HTTP. Default `--mode single` emits one consolidated document (flows as anchored H2 sections); `--mode page-tree` emits a parent overview plus one document per flow. Output lands in `<workspace>/.export/adf/` as `projection.json` + `attachments.json` (file name, source path, sha256 per burned screenshot — falling back to the clean screenshot with a warning when no burned PNG exists). A host agent hands these to the Atlassian MCP, or the `@docsxai/plugin-confluence` publisher (`confluence:push`) consumes them; **all** Confluence HTTP lives in that capability-declared plugin, never in the engine.

`baseline` + `diff` are the drift-detection pair. `baseline` snapshots `flows/` + `docs/` (step `.md`s, `annotations.json`, `screenshots/`, `locators.yaml`) into `<workspace>/.baseline/` (or `--out <dir>`); `diff` compares the live workspace against it (`diffDocPacks` on the library surface) and emits a deterministic `docsxai/drift@1` report — per flow: id-keyed step field deltas, annotation moves beyond a pixel tolerance, screenshot pixel diffs via pngjs (changed-pixel count / pct / changed-region bbox; dimension changes flagged distinctly; `ignore_regions` excluded), prose line-change counts, and locator changes. `--format md` (`formatDriftReportMarkdown`) is PR-comment-ready; `--fail-on warn|fail` exits 1 at/above the threshold (defaults: ≥1% changed pixels = warn, ≥5% = fail, structural change = warn). The engine detects and reports; proposing flow-file patches stays with the host agent (`diagnose`).

`export playwright` renders each flow (with `extends` resolved) as a self-contained Playwright `.spec.ts` (`exportFlowAsPlaywrightTest`) into `<workspace>/.export/tests/`: locator consts, steps as page actions, `wait_for` as waits, `success` as `expect()` assertions, `environment` as `test.use()` + `page.clock.setFixedTime`, `optional` steps in try/catch. Deterministic; generated files carry a "regenerate, don't hand-edit" header.

`render` locates the viewer bin in order: `DOCSX_VIEWER_BIN` (path to the viewer's bin script or an executable), the `@docsxai/viewer` package installed next to the engine (its `bin` run with the current Node), then `docsxai-viewer` on PATH. A launch failure reports all three attempts.

## Auth strategies

Target-site auth lives in `src/auth/` (one module per strategy) behind the `src/auth.ts` re-export shim. Every strategy implements `AuthStrategy.authenticate(ctx) → AuthResult` and reduces to the same universal artifact: a **`storageState`** (cookies + localStorage) the runtime seeds the browser context with, plus — for connection-level schemes — `contextOptions` (`httpCredentials` / `extraHTTPHeaders` / `clientCertificates`) passed through to `browser.newContext`. Roles are declared in `<workspace>/auth/strategy.yaml` (`docsxai/auth-strategy@1`): per-role `strategy`, `creds_env` (credential **keys → env-var names**, never values), `options`, and `cache` (local/backend store, `ttl`, `auth_cookie` expiry pinning).

| Strategy         | Scheme                                                                                                                                                                                                             | Browser needed |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `api-login`      | POST creds to the login endpoint; cookies collected across the redirect chain (own RFC-6265 jar)                                                                                                                   | no             |
| `ui-form`        | drive the app's own login form: fill, submit, success marker, snapshot; `pre_steps` dismiss pre-login chrome; `options.totp` adds an RFC-6238 hop (dep-free `generateTotp`/`verifyTotp` primitives exported)       | headless       |
| `email-otp`      | `ui-form` whose code arrives by mail; an `InboxProvider` polls the inbox (`http-json` built-in: Mailpit-style `{ messages: [{to, received_at, body}] }`); `code_pattern` extracts the code (default `\b(\d{6})\b`) | headless       |
| `webauthn`       | passkey via a CDP virtual authenticator (ctap2 / internal / user-verifying), attached **before** navigation; `trigger_selector` starts the ceremony                                                                | headless       |
| `jwt-injection`  | static token (`token_env`) or OAuth2 client-credentials mint (`token_url`); injected into localStorage and/or cookies via `{{token}}` templates                                                                    | no             |
| `http-basic`     | connection-level `httpCredentials`                                                                                                                                                                                 | no             |
| `pat-header`     | token header via `extraHTTPHeaders` (`value_template`, default `Bearer {{token}}`)                                                                                                                                 | no             |
| `mtls`           | client certificate via `clientCertificates` (`creds_env` maps `cert`/`key` to PEM file paths)                                                                                                                      | no             |
| `test-backdoor`  | POST a shared secret to a test-only endpoint                                                                                                                                                                       | no             |
| `manual-capture` | instrumented Chrome; a human logs in and triggers capture                                                                                                                                                          | headed         |

Cross-cutting contracts:

- **Secrets stay out of band.** Strategies read env-var _names_ from the descriptor and resolve values at run time; error messages mask values as `<SET>`/`<UNSET>` and never echo them.
- **User pools.** Any credential env value may be comma-separated (`u1,u2,u3`); `resolveCreds({ workerIndex })` gives parallel worker N entry `N % len`, consistently across every pooled variable.
- **`expiresAt` when derivable.** From the named / lone real-expiry cookie (`jarAuthExpiry`), the JWT `exp` claim, or the token endpoint's `expires_in`; the cache's `auth_cookie` / `ttl` rules cover the rest.
- **Registries.** `registerAuthStrategy(name, impl)` adds or overrides a scheme (consulted before the built-ins — the plugins-runtime hook); `registerInboxProvider(name, factory)` adds `email-otp` inbox shapes.
- **One Playwright import site.** Browser-driving strategies depend on the narrow `AuthPage` interface (`src/auth/browser-session.ts`); the default launcher routes through `launchPlaywrightSession`, so unit tests fake the page and `playwright-driver.ts` remains the engine's single Playwright integration point.

## Plugins

The engine hosts a workspace plugin runtime (v1) with four extension points: **publishers**, **renderers**, **lint-rules**, and **auth-strategies**. Plugins are normal npm packages: a `docsxai` field on `package.json` plus a module exporting `register(api)`. They run **in-process and unsandboxed** — `trust` is a review signal, not a boundary — and the no-model-API rule binds them exactly as it binds the engine.

### Manifest (`package.json#docsxai`)

```json
{
  "name": "@docsxai/plugin-confluence",
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

Two optional `.docsxai.json` keys wire plugins into a workspace:

```json
{
  "plugins": [{ "package": "@docsxai/plugin-confluence" }, { "path": "../my-local-plugin" }],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

`plugins-lock.json` (schema `docsxai/plugins-lock@1`, next to the config) pins each plugin's register-module sha256. When it exists, every resolve verifies the bytes **before** importing; a mismatch fails closed with a "run `docsxai plugins sync`" message.

### CLI

```
docsxai plugins list <workspace>             status table (loaded / disabled reasons); exit 1 if any plugin isn't loaded
docsxai plugins info <workspace> <namespace> manifest + registered artifact names
docsxai plugins sync <workspace>             (re)write plugins-lock.json — never executes plugin code
```

All three accept `--format json`. Plugins are resolved once per CLI invocation — there is no hot reload. See `docs/ai-context/plugin-runtime/lifecycle-and-namespacing.md` for the full lifecycle contract.

## License

[Apache-2.0](../../LICENSE).
