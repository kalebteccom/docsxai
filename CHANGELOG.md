# Changelog

All notable changes to this project. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver once the public release lands.

## Unreleased

> **Not yet published.** The repo is release-*prepared* but stays private; the public flip (npm publish + repo visibility + git tag) is owner-deferred (2026-05-19). See [`RELEASING.md`](RELEASING.md) for the mechanical go-public checklist. This section documents what the first published release *will* ship.

The MVP: an LLM-agnostic engine + Claude Code plugin that walks a web app, follows written flows, and emits screenshot-rich docs. Calibration is AI-assisted and rare; execution is deterministic, agent-free, and CI-friendly.

### Added

#### Engine — plugins runtime (`@kalebtec/docsxai-engine`)

- **Workspace plugin runtime v1** — four extension points (publishers, renderers, lint-rules, auth-strategies) via a `docsxai` manifest on a plugin package's `package.json` plus a `register(api)` module. Resolved once per CLI invocation; mandatory `<namespace>:<name>` prefixing (reserved: `site-docs`, `docsxai`, `core`, `plugins`); `dependsOn` topological load with cycle rejection; capability declarations (`egress:<host-glob>`) subset-checked against workspace `plugin_capabilities`; in-process and unsandboxed — `trust` is a review signal. Lifecycle contract: `docs/ai-context/plugin-runtime/lifecycle-and-namespacing.md`.
- **`site-docs plugins list|info|sync`** — status table (load/disable reasons), manifest introspection, and `plugins-lock.json` sha256 pinning verified before any register module is imported (mismatch fails closed; `sync` never executes plugin code).

#### Engine — execution determinism + redaction

- **`environment` block** in the flow-file (`clock` freeze, `locale`, `timezone`, `viewport` incl. `desktop`/`tablet`/`mobile` presets, `color_scheme`, `reduced_motion`) applied at session creation; per-key child-wins `extends` merge; CDP-attached sessions apply what page-level APIs allow and warn once on the rest.
- **Deterministic `redactions`** — flow-level + per-step, selector- or region-based, `box` (solid fill) or `pixelate` (16px mosaic); applied in-memory before any screenshot byte hits disk, halt screenshots included; annotation-on-redacted-target lint guard.
- **Real `element_stable`** — best-effort bounding-box stability poll (two consecutive identical reads, 10 s budget).
- **Lint R005–R010** (missing `extends` target, unused locator, terminal step without `success`, un-guarded `optional`, selector-less `element_stable`, annotation anchored to a redacted element) + injectable `extraRules` for lint-rule plugins.
- **Byte-identical determinism keystone** — frozen-clock + redacted flow re-run twice asserts identical screenshot bytes against real Chromium.
- `BrowserDriver.screenshot` gained an optional `redactions` parameter (external driver implementers take note).

#### Engine — workspace + CLI hygiene

- **`resolveWorkspacePath` / `resolveWorkspacePathReal`** — the filesystem chokepoint: every workspace artifact read/write routes through containment checks (separator-boundary prefix + realpath symlink-escape defense); typed `WorkspacePathEscapeError`.
- **In-process deterministic `site-docs zip`** (fflate) — no system `zip` binary; sorted entries, zip-epoch mtimes, fixed compression: same doc pack → byte-identical archive; workspace-escaping symlinks never archived.
- **Layered viewer-bin resolution for `render`** — `SITE_DOCS_VIEWER_BIN` → installed `@kalebtec/docsxai-viewer` bin (run with current Node) → PATH, all three attempts reported on failure.
- Full library surface exported from the package root (lint / flow-tree / diagnose / style / backend-client / doc-pack-io / zip were previously CLI-only); dead in-engine pipeline Stage contract removed (the dropped calibration-stage shape — agent orchestration lives at the harness/MCP layer).

#### Engine (`@kalebtec/docsxai-engine`)

- **Flow-file format** — declarative YAML (`prerequisites` / `locators` / `steps[]`), `extends:` composition, schema-validated, hand-editable. Actions: `navigate` / `click` / `fill` / `upload` (file-input via Playwright `setInputFiles`) / `press` / `hover` / `select` / `check` / `uncheck` / `wait`.
- **Deterministic runtime** — `site-docs run` replays a doc pack headless with zero agent/LLM involvement; byte-identical re-runs (keystone test).
- **`optional: true` steps** — best-effort steps for conditionally-present UI (confirmation modals, first-run tooltips, cookie banners); skipped (logged, no screenshot/annotation) instead of halting.
- **Calibration aids** — `site-docs lint` (static flow-file checks), `flow-tree` (extends-graph + collision check), `diagnose` (halt context + typed recommendations), `inspect` (live-page locator discovery).
- **Fast iteration** — `run --start-from <step> --cdp <endpoint>` skips to a tail step against an already-warm Chrome; sub-3-sec inner loop on long-async flows.
- **`actionable()` predicate** — portable element-state probe (`actionable`/`disabled`/`off-screen`/`covered`/…) for browser-bridge consumers; contract in `docs/actionability-contract.md`.
- **Halt-cause prefix** — flow-execution errors lead with an inferred 1-line cause parsed from the Playwright actionability log.
- **Target-site auth** — `auth/strategy.yaml` descriptor + `manual-capture` strategy (security-lowered instrumented Chrome, local `storageState` cache, real-cookie-expiry tracking, persistent profile, `--cdp` attach).
- **Style artifact** — `site-docs style` init/validate + derived JSON + jargon-leak scanner (semantic-reshape enforcement).
- **Hand-off** — `site-docs zip` packages a reviewer-ready archive (excludes operator-local `.auth/`, halts, `.viewer/`).
- **Backend client** — `site-docs login` / `push` / `pull` against the stub backend (linear immutable revisions).

#### Plugin (`@kalebtec/docsxai-plugin`)

- Claude Code plugin: `calibrate` + `diagnose` skills; `run` / `render` / `login` / `push` / `pull` commands.
- Static bundle validation (`validatePluginBundle`) cross-checked against the engine CLI surface.

#### Viewer (`@kalebtec/docsxai-viewer`)

- Static HTML viewer: pulsing halo + numbered badges + Popper-placed callouts over clean screenshots; per-annotation `nudge`.
- Robust two-pass callout sizing measured on a `document.body`-attached probe (the callout is detached + `display:none` until `:hover` at build time, so an in-place measure bakes `width:0px` and collapses it to a one-character column); no-cache metas + visible render timestamp.

#### Backend (`@kalebtec/docsxai-backend`)

- Stub service with the concrete REST endpoint list, bearer auth, in-memory linear immutable revisions. (Persistent backing + OAuth interactive flow are post-MVP.)

#### Skill (`@kalebtec/docsxai-skill`)

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

### Changed

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
