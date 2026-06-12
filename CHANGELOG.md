# Changelog

All notable changes to this project. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver once the public release lands.

## Unreleased

> **Not yet published.** The repo is release-*prepared* but stays private; the public flip (npm publish + repo visibility + git tag) is owner-deferred (2026-05-19). See [`RELEASING.md`](RELEASING.md) for the mechanical go-public checklist. This section documents what the first published release *will* ship.

The MVP: an LLM-agnostic engine + Claude Code plugin that walks a web app, follows written flows, and emits screenshot-rich docs. Calibration is AI-assisted and rare; execution is deterministic, agent-free, and CI-friendly.

### Added

#### MCP server (`@docsxai/mcp`)

- **Standalone stdio MCP server** (`docsxai-mcp` bin, `--workspace <dir>` default) exposing calibration meta-orchestration + read-only doc-pack introspection to any MCP-speaking host — no browser primitives (live-page discovery stays browxai's surface). Fourteen tools: `init_workspace`, `run_flows` (flow filter / `startFrom` / `stopAfter` / CDP attach / bounded concurrency; per-flow ok / halt-cause / artifact paths; merged-flow `environment` passed into the Playwright session), `render_viewer`, `lint_flows` (incl. plugin `extraRules`), `flow_tree`, `diagnose_halt`, `style_check`, `zip_pack`, `push_pack`, `pull_pack`, `list_flows`, `get_annotations`, `get_run_artifacts` (paths only), `plugins_list`. Structured `{ok, …} | {ok:false, error, hint}` results throughout.
- **Scripted-client acceptance suite** — an in-process linked client/server pair over the SDK's `InMemoryTransport` drives the whole surface as a non-Claude MCP client, including `run_flows` against the toy-site fixture over real Chromium (loopback `node:http`, Chromium-gated). Add-a-tool checklist: `docs/ai-context/tool-registration/mcp-tool-registry.md`.
- Streamable-HTTP transport deferred per roadmap; the package stays `private: true` until the public flip.

#### Engine — plugins runtime (`@docsxai/engine`)

- **Workspace plugin runtime v1** — four extension points (publishers, renderers, lint-rules, auth-strategies) via a `docsxai` manifest on a plugin package's `package.json` plus a `register(api)` module. Resolved once per CLI invocation; mandatory `<namespace>:<name>` prefixing (reserved: `docsxai`, `site-docs`, `core`, `plugins`); `dependsOn` topological load with cycle rejection; capability declarations (`egress:<host-glob>`) subset-checked against workspace `plugin_capabilities`; in-process and unsandboxed — `trust` is a review signal. Lifecycle contract: `docs/ai-context/plugin-runtime/lifecycle-and-namespacing.md`.
- **`docsxai plugins list|info|sync`** — status table (load/disable reasons), manifest introspection, and `plugins-lock.json` sha256 pinning verified before any register module is imported (mismatch fails closed; `sync` never executes plugin code).

#### Engine — ADF export + Confluence publisher

- **`docsxai export adf` + `projectDocPackToAdf`** — pure, deterministic Confluence ADF projection of the doc pack (zero HTTP): one consolidated document with anchored H2 flow sections (default `single` mode) or a parent overview + one document per flow (`page-tree`); markdown-subset → ADF converter (paragraphs, bold/em/code, links, lists, fenced code; raw HTML stays literal text); per-step `mediaSingle` nodes referencing burned PNGs (clean-screenshot fallback with a warning) plus an attachments manifest with sha256s. Writes `<workspace>/.export/adf/{projection,attachments}.json` — the artifact a host agent hands to the Atlassian MCP.
- **`@docsxai/plugin-confluence`** — first publisher plugin (`confluence:push`): Confluence Cloud REST v2 via built-in `fetch`, capability-declared `egress:*.atlassian.net` (the only Confluence egress path — the engine emits projections only). Page identity is the `{ section → pageId }` `config.page_map` (each result page echoes its `section`); idempotent via a `docsxai-content-sha` content-property — re-publishing an unchanged projection performs zero mutations, and attachment uploads are skipped when the same-name attachment carries a matching `docsxai-sha256:<hex>` comment; the API token is masked as `<CONFLUENCE_TOKEN>` in every error/log line. Verified against an in-process fake v2 server that counts mutations, loaded through the real `resolvePlugins` path.

#### Engine — execution determinism + redaction

- **`environment` block** in the flow-file (`clock` freeze, `locale`, `timezone`, `viewport` incl. `desktop`/`tablet`/`mobile` presets, `color_scheme`, `reduced_motion`) applied at session creation; per-key child-wins `extends` merge; CDP-attached sessions apply what page-level APIs allow and warn once on the rest.
- **Deterministic `redactions`** — flow-level + per-step, selector- or region-based, `box` (solid fill) or `pixelate` (16px mosaic); applied in-memory before any screenshot byte hits disk, halt screenshots included; annotation-on-redacted-target lint guard.
- **Real `element_stable`** — best-effort bounding-box stability poll (two consecutive identical reads, 10 s budget).
- **Lint R005–R010** (missing `extends` target, unused locator, terminal step without `success`, un-guarded `optional`, selector-less `element_stable`, annotation anchored to a redacted element) + injectable `extraRules` for lint-rule plugins.
- **Byte-identical determinism keystone** — frozen-clock + redacted flow re-run twice asserts identical screenshot bytes against real Chromium.
- `BrowserDriver.screenshot` gained an optional `redactions` parameter (external driver implementers take note).

#### Engine — workspace + CLI hygiene

- **`resolveWorkspacePath` / `resolveWorkspacePathReal`** — the filesystem chokepoint: every workspace artifact read/write routes through containment checks (separator-boundary prefix + realpath symlink-escape defense); typed `WorkspacePathEscapeError`.
- **In-process deterministic `docsxai zip`** (fflate) — no system `zip` binary; sorted entries, zip-epoch mtimes, fixed compression: same doc pack → byte-identical archive; workspace-escaping symlinks never archived.
- **Layered viewer-bin resolution for `render`** — `DOCSX_VIEWER_BIN` → installed `@docsxai/viewer` bin (run with current Node) → PATH, all three attempts reported on failure.
- Full library surface exported from the package root (lint / flow-tree / diagnose / style / backend-client / doc-pack-io / zip were previously CLI-only); dead in-engine pipeline Stage contract removed (the dropped calibration-stage shape — agent orchestration lives at the harness/MCP layer).

#### Engine (`@docsxai/engine`)

- **Flow-file format** — declarative YAML (`prerequisites` / `locators` / `steps[]`), `extends:` composition, schema-validated, hand-editable. Actions: `navigate` / `click` / `fill` / `upload` (file-input via Playwright `setInputFiles`) / `press` / `hover` / `select` / `check` / `uncheck` / `wait`.
- **Deterministic runtime** — `docsxai run` replays a doc pack headless with zero agent/LLM involvement; byte-identical re-runs (keystone test).
- **`optional: true` steps** — best-effort steps for conditionally-present UI (confirmation modals, first-run tooltips, cookie banners); skipped (logged, no screenshot/annotation) instead of halting.
- **Calibration aids** — `docsxai lint` (static flow-file checks), `flow-tree` (extends-graph + collision check), `diagnose` (halt context + typed recommendations), `inspect` (live-page locator discovery).
- **Fast iteration** — `run --start-from <step> --cdp <endpoint>` skips to a tail step against an already-warm Chrome; sub-3-sec inner loop on long-async flows.
- **`actionable()` predicate** — portable element-state probe (`actionable`/`disabled`/`off-screen`/`covered`/…) for browser-bridge consumers; contract in `docs/actionability-contract.md`.
- **Halt-cause prefix** — flow-execution errors lead with an inferred 1-line cause parsed from the Playwright actionability log.
- **Target-site auth** — `auth/strategy.yaml` descriptor + `manual-capture` strategy (security-lowered instrumented Chrome, local `storageState` cache, real-cookie-expiry tracking, persistent profile, `--cdp` attach).
- **Scripted auth catalogue** — unattended re-auth strategies, one module per scheme under `src/auth/`: `api-login` (redirect-chain cookie collection via an own RFC-6265 jar), `ui-form` (drive the app's login form; `pre_steps` for pre-login chrome; `options.totp` RFC-6238 hop with dep-free `generateTotp`/`verifyTotp`), `email-otp` (pluggable `InboxProvider` polling — `http-json` built-in, `code_pattern` extraction, `registerInboxProvider` hook), `webauthn` (CDP virtual authenticator attached before navigation), `jwt-injection` (static token or OAuth2 client-credentials mint; localStorage/cookie injection), `http-basic` / `pat-header` / `mtls` (connection-level context options), `test-backdoor`. Credential **user pools** (comma-separated env values; per-worker consistent pick via `resolveCreds`), `registerAuthStrategy` plugin hook consulted before the built-ins, `expiresAt` derived whenever credible (cookie expiry / JWT `exp` / `expires_in`), secret values never echoed.
- **Style artifact** — `docsxai style` init/validate + derived JSON + jargon-leak scanner (semantic-reshape enforcement).
- **Hand-off** — `docsxai zip` packages a reviewer-ready archive (excludes operator-local `.auth/`, halts, `.viewer/`).
- **Backend client** — `docsxai login` / `push` / `pull` against the stub backend (linear immutable revisions).

#### Engine — ADF export + Confluence publisher

- **`docsxai export adf`** + `projectDocPackToAdf` — pure, deterministic Atlassian-Document-Format projection of a doc pack (markdown-subset → ADF, burned-screenshot media references with clean-screenshot fallback, single consolidated page or opt-in page-tree). Writes the agentic-path artifact a host agent hands to the Atlassian MCP.
- **`@docsxai/plugin-confluence`** — first-party `confluence:push` publisher plugin (the plugin runtime's keystone consumer): Confluence Cloud REST v2 via built-in fetch, `egress:*.atlassian.net` capability, create/update keyed on a `docsxai-content-sha` content-property so re-publishes are idempotent (3×-republish test: zero mutations), attachment dedupe by sha, `{ section → pageId }` page-identity map for backend revision metadata, `<CONFLUENCE_TOKEN>` masking on every error path. Live-site validation remains owner-gated.

#### Viewer — Starlight docs site (`@docsxai/viewer`)

- **`emitStarlightSite` / `buildStarlightSite` + `docsxai-viewer site`** — emits a complete, buildable Astro Starlight project from a doc pack: one MDX page per flow (H2 per step, step prose verbatim, `<AnnotatedShot>` figures with captions numbered to the burned badge indexes), a landing page of flow cards, a sidebar ordered by the flow `extends` graph, theme accent/logo from the style artifact's `visual` keys (`--title`/`--accent` overrides). Burned PNGs preferred, clean-screenshot fallback. Deterministic (two emits byte-identical), self-contained (no remote fonts/CDN imports); `astro@6.4.6` + `@astrojs/starlight@0.40.0` (MIT) exact-pinned into the emitted `package.json`; `--build` runs `astro build` against the workspace-pinned install via per-package symlinks (zero network at build), real-build E2E gated behind `DOCSX_STARLIGHT_BUILD=1`. The single-file interactive viewer remains the zero-dependency default/embed renderer.
- **`@docsxai/plugin-starlight`** — first renderer plugin (`starlight:site`): thin adapter over the emitter/builder, zero capabilities, loaded through the real `resolvePlugins` path in tests.

#### Engine — drift detection + test export

- **`docsxai baseline` + `docsxai diff`** — deterministic drift reports (`docsxai/drift@1`): id-keyed step deltas, annotation moves beyond a px tolerance, exact RGBA screenshot pixel diffs (with `ignore_regions`), prose line-change counts, locator changes; `--format json|md|text` (the markdown form is PR-comment-ready) and a `--fail-on warn|fail` CI gate. Drift detection is engine-deterministic; the patch proposal stays an explicit agent step (`diagnose`) — never ambient.
- **`docsxai export playwright`** — one self-contained Playwright `.spec.ts` per flow (extends resolved, `environment` as `test.use()` + fixed clock, optional steps try/catch-wrapped, regenerate-don't-hand-edit header): the doc pack doubles as a regression suite.

#### Backend — GitHub App webhook surface (`@docsxai/backend`)

- **`POST /v1/github/webhook`** — HMAC-SHA-256-signature-verified (timing-safe; GitHub's documented test vector pinned), event-filtered, replay-guarded (last 100 delivery ids) webhook endpoint; per-project `webhook-config` CRUD (repo mapping, events, output strategy, revision pin). Zero YAML in user repos — config lives in the backend.
- **Run dispatch** — per-project serial `QueuedDispatcher` → `SpawnRunner`: materializes the configured revision into a temp workspace, runs the engine CLI, appends run history.
- **Output strategies** — `pr-comment` (GitHub REST comment with the run/drift summary), `viewer-refresh` (re-render recorded as a content-addressed blob), `wiki-push` (the project's configured publisher plugin via the engine plugin runtime). App registration, webhook URL/secret, and installation tokens are owner-gated (checklist in the backend README).

#### Backend — persistence, blobs, OAuth, encrypted cache (`@docsxai/backend`)

- **Filesystem persistence** — `FsStore` behind the new `BackendStore` interface (atomic tmp+rename writes, traversal-guarded paths), selected via `--data-dir` / `DOCSX_DATA_DIR`; the in-memory store remains the default for tests.
- **Content-addressed blobs** — `POST/GET/HEAD /v1/blobs` (sha256-addressed, deduplicated) with 10 MB JSON / 25 MB blob body limits (413). Screenshots travel as `docsxai/screenshots@2` sha256 manifests; the engine HEAD-probes, uploads, and integrity-verifies on pull (base64 payloads are gone).
- **Revision finalisation** — `POST …/revisions/:rev/finalize`; artifact PUTs afterwards are rejected 409 (`revision-finalized`); `docsxai push` finalizes — linear-immutable is now enforced, not aspirational.
- **OAuth 2.1 + PKCE** — S256-only authorization-code flow with single-use 5-minute codes, refresh-token rotation, sha256-hashed token storage; CI keeps the `DOCSX_TOKEN` bearer path. `docsxai login --oauth` runs the loopback handshake and stores tokens at `.auth/backend-token.json` (0600) with auto-refresh.
- **Encrypted storage-state relay** — `PUT/GET/DELETE /v1/workspaces/:ws/auth-cache/:role` stores client-side AES-256-GCM envelopes (`BackendStateCache`, key from `DOCSX_CACHE_KEY`); the backend never sees plaintext session state.
- **Run history wired** — `docsxai run` appends execution records to backend-bound workspaces (offline-tolerant).

#### Viewer — burn renderer + hardening (`@docsxai/viewer`)

- **`burn` — durable burned annotations** — browser-free Satori → resvg pipeline bakes halo/badge/callout/arrow onto screenshot copies (`docs/<flow>/burned/`), byte-deterministic, positioned by the same `placeCallout` as the interactive viewer; vendored Inter (OFL-1.1). The static-delivery path for Confluence/Notion-class surfaces.
- **Single-sourced overlay** — the inline viewer script is bundled at build from `overlay-runtime.ts` importing the real `placeCallout`; the hand-maintained ES5 port is gone.
- **CSP + safe markdown** — every emitted page carries `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'` (zero network egress), and step write-ups render through micromark in safe mode instead of `<pre>`.

#### Engine — CLI integration

- `docsxai run` applies the merged flow's `environment` block to every launched session; `docsxai lint` resolves the workspace plugin registry and runs registered lint-rule plugins after the built-ins (plugin failures degrade to core rules with a warning).

#### Plugin (`@docsxai/plugin`)

- Claude Code plugin: `calibrate` + `diagnose` skills; `run` / `render` / `login` / `push` / `pull` commands.
- Static bundle validation (`validatePluginBundle`) cross-checked against the engine CLI surface.

#### Viewer (`@docsxai/viewer`)

- Static HTML viewer: pulsing halo + numbered badges + Popper-placed callouts over clean screenshots; per-annotation `nudge`.
- Robust two-pass callout sizing measured on a `document.body`-attached probe (the callout is detached + `display:none` until `:hover` at build time, so an in-place measure bakes `width:0px` and collapses it to a one-character column); no-cache metas + visible render timestamp.

#### Backend (`@docsxai/backend`)

- Stub service with the concrete REST endpoint list, bearer auth, in-memory linear immutable revisions. (Persistent backing + OAuth interactive flow are post-MVP.)

#### Skill (`@docsxai/skill`)

- Vendorable `.claude/skills/` fallback delegating to the installed plugin.

#### Cross-cutting

- Apache-2.0; OSS-clean; public-release-ready content (history scrubbed of client identifiers 2026-05-15).
- ~208 tests across the monorepo; typecheck clean; CI = typecheck + test on Node 20 / pnpm.
- Browxai is the canonical model-agnostic discovery driver (integration contract in `docs/browxai-asks.md`).

#### Quality + governance baseline

- ESLint flat config with custom rules (`no-tracker-ids-in-comments`, `no-page-eval-stringified-arrow`).
- Strict Prettier + `.editorconfig` + `.githooks/` + extended quality CI workflow (lint / format-check / audit / secret-scan / zizmor / package-contents jobs).
- Multi-harness configuration: `AGENTS.md`, `.cursor/rules/`, `.codex/`, `.agents/skills/`, `.claude/agents/`.
- `docs/ai-context` subtree — architecture, agent-process, secrets-and-egress, testing, release-process, investigations, adopter-reports.
- Governance: `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `MAINTAINERS.md`, `THIRD_PARTY_NOTICES.md`, expanded `CONTRIBUTING.md`.
- Public-flip checklists (planning + operational), security best practices for adopters.
- Per-package `tsconfig.build.json` (`sourceMap` and `declarationMap` off; excludes test files).
- Dedicated `packages/docsxai/` publishable stub with `publishConfig` for OIDC trusted publishing.
- 6-package OIDC publish pipeline in `release.yml`.

#### Docs site (`@docsxai/website`)

- **Public documentation site** (docsxai.com) — Astro 6 + Starlight 0.40 workspace package in `website/`, ember (golden-bronze) brand layer, six-section IA (Start here / Concepts / Guides / Reference / Packages / Project). `sync-docs.mjs` generates the published ports from the canonical sources (`docs/*.md`, package READMEs, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`) with per-source-depth link rewriting and per-page strike/replace rules; `leak-guard.mjs` fails the build on links to internal doc trees, portfolio-repo references, absolute local paths, or client codenames; `scripts/prose-guard.mjs` bans em/en dashes and stock AI-voice tells from every published page. Netlify deploy config + root `docs:dev` / `docs:build` / `docs:preview` proxies.

### Changed

- **Project-wide rename to `docsxai`** — a single pre-publish clean break (owner decision, 2026-06-12; nothing published, no compatibility aliases): CLI `site-docs` → `docsxai`; npm packages `@kalebtec/docsxai-*` → `@docsxai/*` on the registered `@docsxai` org; env vars `SITE_DOCS_*` → `DOCSX_*`; workspace config `.site-docs.json` → `.docsxai.json`; schema ids `site-docs/<thing>@N` → `docsxai/<thing>@N`; API version header `Site-Docs-API-Version` → `Docsxai-Api-Version`; page helper `window.__siteDocs` → `window.__docsxai`; Claude Code plugin manifest + slash commands `/site-docs:*` → `/docsxai:*`. The plugin runtime keeps `site-docs` in `RESERVED_NAMESPACES` defensively.
- Renamed workspace packages `@kalebtec/site-docs-*` → `@kalebtec/docsxai-*` (engine, backend, plugin, skill, viewer); workspace root `site-docs-monorepo` → `docsxai-monorepo`.
- CLI bin names `site-docs-backend` → `docsxai-backend`, etc.
- 5 scoped workspace packages flipped from `private: true` to publishable.
- Repo root structure: historical closure plans moved to `docs/archive/phase-plans/`.
- Lint baseline driven to 0 errors / 0 warnings (load-bearing CI gate).
- Sourcemap leak gates added; published tarballs verified clean.
- Scrubbed planning / cross-repo-tracking references from source-file headers (`packages/backend/src/api.ts`, `packages/engine/src/{cli,index,backend-client}.ts`, `packages/viewer/src/render.ts`) so the inline narration reads standalone.
- Scrubbed migration / cross-repo-comparison phrasing from permanent docs so the project reads standalone. Technical interop references (browxai as the canonical model-agnostic discovery driver, the integration contract at `docs/browxai-asks.md`, the actionability contract for browser-bridge consumers) stay.
- Scrubbed every internal phase / round reference across `README.md`, `AGENTS.md`, `RELEASING.md`, `MAINTAINERS.md`, `THIRD_PARTY_NOTICES.md`, `docs/`, `docs/ai-context/`, `packages/*/README.md`, `packages/plugin/commands/`, `.agents/skills/`, `.claude/agents/`, and `.codex/agents/`. Adopters landing on the repo see no internal phase nomenclature; the portfolio repo carries the planning history.
- Updated `docs/agent-runbook.md` and `docs/running-against-an-app-repo.md` to use the current viewer / backend bin names (`docsxai-viewer`, `docsxai-backend`) after the rename from `site-docs-*`.
- Refreshed `packages/plugin/README.md`: `push` / `pull` commands shipped, dropped from the TODO row; `style-learn` / `translate` removed entirely (not on the near-term roadmap); MCP-server note recast as a possible future addition rather than a deferred deliverable.
- Added `TypeScript configs for packages and libs` and `Package formatting scripts` sections to `docs/ai-context/agent-process/code-quality.md`, codifying the per-package `tsconfig.json` (dev / typecheck) + `tsconfig.build.json` (emit, excludes tests) split and the root-cwd `pnpm format` / `format:check` convention.

### Fixed

- CI build-step ordering (added `pnpm -r build` before `pnpm -r test` so engine's workspace-package resolution works).
- 22-day red CI on `main` cleared after lockfile + build-step ordering fixes.
- 9 high-severity zizmor workflow findings cleared (cache-poisoning, excessive-permissions, unpinned-uses, bot-conditions).
- One `no-page-eval-stringified-arrow` violation in `packages/engine/src/playwright-instrumented-browser.ts` — converted to function expression + `PageEval` type wrapper.

### Removed

- Empty `examples/` stub directory (real keystone fixtures live at `packages/engine/test/fixtures/toy-site/`).
- Workspace-root publishable stub (replaced by dedicated `packages/docsxai/` sub-package).

### Security

- Trufflehog secret-scan in CI (replaced gitleaks per universal-baseline rule 28 cost/availability).
- Bot-identity hardening in `dependabot-auto-merge.yml` (`user.type == 'Bot'` + `user.login == 'dependabot[bot]'` check, not spoofable `github.actor`).
- All third-party GitHub Actions SHA-pinned with version comments.
- `release.yml` uses OIDC trusted publishing (no `NPM_TOKEN`); environment-gated; tag-triggered only.
