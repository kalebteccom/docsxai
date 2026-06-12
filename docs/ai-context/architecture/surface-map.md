# Surface map (deep)

`AGENTS.md` carries the high-level map. This page goes one level deeper for the substructure agents most often need to navigate.

The engine never imports a model-provider SDK. That boundary is load-bearing — repeat it twice on every architectural decision involving inference.

## `packages/engine/` — `@docsxai/engine`

The flow-file parser + deterministic runtime + the `docsxai` CLI. The biggest package; the only one with a binary.

### `packages/engine/src/cli.ts`

The `docsxai` bin. Subcommands: `init`, `capture-auth`, `calibrate`, `inspect`, `run`, `render`, `lint`, `flow-tree`, `diagnose`, `style`, `zip`. The bin is `dist/cli.js` after build. **Argument parsing + dispatch only — no business logic.** Per-command logic lives in the corresponding module.

### `packages/engine/src/flow-file.ts`

Zod schema + parser for the flow-file format. `prerequisites` + `locators` + `steps[]` (`action`, `target`, `wait_for`, `success`, `annotation` / `annotations`). `extends:` composition for shared preambles. Nothing in a flow-file is ever `eval`'d; the step vocabulary is curated and finite.

### `packages/engine/src/flow-runtime.ts`

The deterministic execution loop. Reads a parsed flow + locator manifest + auth descriptor, drives the `BrowserDriver`, emits ActionResult per step, writes annotations + screenshots. **No agent, no LLM, no inference.** Same input → same output (keystone-enforced).

### `packages/engine/src/playwright-driver.ts`

The one `BrowserDriver` implementation. Includes the `actionable()` predicate (the load-bearing portable contract — see [`../../actionability-contract.md`](../../actionability-contract.md)). All Playwright API touch goes through this file; nothing else in the engine imports `playwright-core` directly.

### `packages/engine/src/playwright-instrumented-browser.ts`

Security-lowered instrumented Chrome used by the `manual-capture` auth strategy. Spawns a real (head-full) browser so a human can log in; cookies + `storageState` cached afterwards. This path lives behind the operator's explicit `capture-auth` invocation; never spawned silently.

### `packages/engine/src/auth.ts`

Auth strategy descriptor (`auth/strategy.yaml`) + the `manual-capture` strategy. The interface is shaped to accommodate other strategies (API-direct, JWT-injection) without runtime changes.

### `packages/engine/src/calibrate.ts`

The `calibrate` command — extracts a flow-file from a structured guide. Calibration-time helper; deterministic given the same guide. The host agent supplies inference _before_ this stage by writing the guide; the engine never calls a model API.

### `packages/engine/src/flow-lint.ts`

Static checks across flow-files. R001–R010 today (and counting), plus `extraRules` injection — the lint-rules plugin extension point. Pure analysis on parsed flows; no browser touch.

### `packages/engine/src/flow-tree.ts`

Visualises the `extends` graph across a workspace's flow-files. Pure read-only.

### `packages/engine/src/diagnose.ts`

Halt-context + recommendations after a deterministic run halts. Reads the halt artifact written by `flow-runtime.ts` and emits a recalibration recommendation. Pure analysis — does not re-run.

### `packages/engine/src/style.ts`

Style.yaml init/validate + the `--check` jargon scan. Workspace-scoped.

### `packages/engine/src/zip.ts`

Doc-pack hand-off packager. Reads from the workspace root via `workspace.ts`; writes one zip.

### `packages/engine/src/workspace.ts`

`resolveWorkspacePath` chokepoint. **All filesystem IO goes through this.** No `cwd`-relative paths in handler code; the workspace argument from the CLI is the only filesystem root.

### `packages/engine/src/doc-pack.ts`, `doc-pack-io.ts`

Doc-pack shape (zod schemas incl. `environment` + `redactions`) + payload IO. `doc-pack-io.ts` carries the `screenshots@2` sha256 blob manifests for backend transport. (The old `pipeline.ts` Stage contract is gone — agent orchestration lives at the harness/MCP layer, never in-engine.)

### `packages/engine/src/plugins/`

The workspace plugin runtime v1: manifest (`package.json#docsxai`), resolve-once loader with namespace prefixing + dependsOn cycle rejection + capability subset checks + sha256 lock, registry exposing publishers / renderers / lint-rules / auth-strategies. Lifecycle contract: `docs/ai-context/plugin-runtime/lifecycle-and-namespacing.md`. Publisher plugins are the only sanctioned wiki/VCS egress path.

### `packages/engine/src/auth/`

The target-site auth catalogue — one module per strategy (api-login, jwt-injection, ui-form, http-basic, pat-header, mtls, email-otp, totp, webauthn, manual-capture, test-backdoor) behind `makeStrategy` + the `registerAuthStrategy` plugin hook. `auth.ts` at the package root is a re-export shim.

### `packages/engine/src/export/`

Pure projections out of a doc pack (no HTTP): `adf.ts` (Confluence ADF + attachments manifest; `docsxai export adf`). New delivery formats land here as exporters; pushing them is publisher-plugin territory.

### `packages/engine/src/backend-client.ts`

HTTP client for `@docsxai/backend`. Used when the operator opts into hosted persistence; local file output is the default for MVP.

### `packages/engine/test/keystone.test.ts`

The regression gate. Drives the runtime end-to-end against real Chromium with a fixture site. Catches behavior regressions that unit tests with a mocked `BrowserDriver` will silently pass. Mandatory for any change to `flow-runtime.ts`, `playwright-driver.ts`, or the actionability predicate.

## `packages/plugin/` — `@docsxai/plugin`

The Claude Code plugin. The recommended invocation surface for agent-driven workflows.

- `.claude-plugin/plugin.json` — the manifest (name, version, description, author).
- `commands/*.md` — deterministic slash commands. Thin wrappers over the `docsxai` CLI. **No business logic in a command file** — the engine does the work.
- `skills/*/SKILL.md` — calibration skills (agent-driven; the host supplies inference).
- `src/index.ts` — a small TS surface over the manifest tree for tooling + tests. `readManifest`, `listCommands`, `listSkills`, plus static-validation helpers.

The plugin loads at session start; commands are deterministic engine invocations; skills emit structured questions and drive the calibration flow through the host agent's inference.

## `packages/backend/` — `@docsxai/backend`

Authenticated stub service for doc-pack persistence.

- `src/api.ts` — `ROUTES` is the canonical endpoint list. `/v1/workspaces/{ws}/projects/{p}/revisions/{rev}/{flows|annotations|screenshots|style|locators|run-history}`. Versioned via the `Docsxai-Api-Version` header.
- `src/server.ts` — HTTP stub server. Loopback-bound by default.
- `src/store.ts` — in-memory linear-immutable revisions (filesystem / DB persistence is post-MVP).

OAuth 2.1 wires hosted deployment post-MVP; the stub runs with bearer tokens.

## `packages/skill/` — `@docsxai/skill`

Optional vendorable `.claude/skills/` fallback. Delegates to the installed plugin.

- `skill/docsxai/SKILL.md` — the vendorable skill manifest.
- `vendorSkill(targetDir)` — copies the skill bundle into `<targetDir>/.claude/skills/docsxai/`. Idempotent.

For teams that prefer version-pinning in the consumer repo rather than relying on a globally-installed plugin.

## `packages/viewer/` — `@docsxai/viewer`

Static-HTML viewer.

- `src/render.ts` — `buildViewer({ docsDir, outDir })`. Reads annotations + screenshots, emits `index.html` + per-flow pages.
- `src/placement.ts` — `placeCallout(input)`. Pure Popper-like placement; coordinate-space-agnostic; tested independently.

PNGs stay clean (no baked annotations) — re-stylable, re-localisable, machine-inspectable. A future release adds `burn.ts` for delivery surfaces that can't run the interactive viewer (Confluence, Notion).

## Load-bearing boundaries

- **The engine never calls a model API.** No `openai`, `@anthropic-ai/*`, `@google/genai`, no provider SDK import path. Lock the boundary with `pnpm licenses:check` + grep at PR time if a future ESLint rule lands.
- **`BrowserDriver` is the only browser abstraction.** Direct `playwright-core` imports outside `playwright-driver.ts` and `playwright-instrumented-browser.ts` are an architectural violation.
- **`resolveWorkspacePath` is the only filesystem root.** No `cwd`-relative paths in engine handlers.
- **Calibration mode and execution mode are split.** Calibration helpers (`calibrate.ts`, the plugin's skill surface) are agent-aware; execution (`flow-runtime.ts`, the keystone test) has no agent in the loop. Don't re-introduce in-engine agent-orchestration state machines (the dropped `DiscoveryStage`/`MappingStage`/`CommitStage` design is the cautionary tale; see [`PHASE-1.md`](../../archive/phase-plans/PHASE-1.md) postmortem).

## `docs/`, `scripts/`

- `docs/` — public adopter runbooks (`agent-runbook.md`, `running-against-an-app-repo.md`, `actionability-contract.md`, `browxai-asks.md`).
- `scripts/` — repo-level scripts (CI helpers, audit utilities). Not part of the published surface.

Keystone-test fixtures live at `packages/engine/test/fixtures/toy-site/`, alongside the test that consumes them.
