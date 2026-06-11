# Changelog

All notable changes to this project. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver once the public release lands.

## Unreleased

### Repo housekeeping

- Archived historical phase-closure docs out of the repo root into `docs/archive/phase-plans/` (`PHASE-0.md`, `PHASE-1.md`). The repo root now follows the standard top-level `.md` set (README / AGENTS / CLAUDE / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / MAINTAINERS / RELEASING / THIRD_PARTY_NOTICES / CHANGELOG / LICENSE). References updated across `README.md`, `AGENTS.md`, `docs/ai-context/`, `docs/running-against-an-app-repo.md`, and `packages/engine/src/index.ts`. The agent-integration-contract postmortem in `PHASE-1.md` remains the load-bearing "why is the engine shaped like this" source — only the path changed.
- Removed the empty `examples/` stub directory at the repo root. The keystone-test fixtures it pointed at live colocated with the test that consumes them at `packages/engine/test/fixtures/toy-site/`; the stub README was the only file under `examples/` and was no longer pointing at anything live.
- Scrubbed migration / cross-repo-comparison phrasing from permanent docs so the project reads standalone. Technical interop references (browxai as the canonical model-agnostic discovery driver, the integration contract at `docs/browxai-asks.md`, the actionability contract for browser-bridge consumers) stay; "matches browxai's pattern" / cross-repo phase-tracking framing is gone.
- Scrubbed planning / phase-tracking references from source-file headers (`packages/backend/src/api.ts`, `packages/engine/src/{cli,index,backend-client}.ts`, `packages/viewer/src/render.ts`) so the inline narration reads standalone. State-of-future references like "Phase 2 hosted backend" survive only as anchorless "when the backend grows real storage" phrasing.
- Updated `docs/agent-runbook.md` and `docs/running-against-an-app-repo.md` to use the current viewer / backend bin names (`docsxai-viewer`, `docsxai-backend`) after the rename from `site-docs-*`.
- Refreshed `packages/plugin/README.md`: `push` / `pull` commands shipped, dropped from the TODO row; `style-learn` / `translate` removed entirely (not on the near-term roadmap); MCP-server note recast as a possible future addition rather than a deferred deliverable.
- Added `TypeScript configs for packages and libs` and `Package formatting scripts` sections to `docs/ai-context/agent-process/code-quality.md`, codifying the per-package `tsconfig.json` (dev / typecheck) + `tsconfig.build.json` (emit, excludes tests) split and the root-cwd `pnpm format` / `format:check` convention.

## [0.1.0] — UNRELEASED

> **Not yet published.** The repo is release-*prepared* but stays private; the public flip (npm publish + repo visibility + git tag) is deferred to ≥ Phase 3 by owner decision (2026-05-19). See [`RELEASING.md`](RELEASING.md) for the mechanical go-public checklist. This entry documents what `0.1.0` *will* ship.

The Phase-1 MVP: an LLM-agnostic engine + Claude Code plugin that walks a web app, follows written flows, and emits screenshot-rich docs. Calibration is AI-assisted and rare; execution is deterministic, agent-free, and CI-friendly.

### Engine (`@kalebtec/docsxai-engine`)

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

### Plugin (`@kalebtec/docsxai-plugin`)

- Claude Code plugin: `calibrate` + `diagnose` skills; `run` / `render` / `login` / `push` / `pull` commands.
- Static bundle validation (`validatePluginBundle`) cross-checked against the engine CLI surface.

### Viewer (`@kalebtec/docsxai-viewer`)

- Static HTML viewer: pulsing halo + numbered badges + Popper-placed callouts over clean screenshots; per-annotation `nudge`.
- Robust two-pass callout sizing measured on a `document.body`-attached probe (the callout is detached + `display:none` until `:hover` at build time, so an in-place measure bakes `width:0px` and collapses it to a one-character column); no-cache metas + visible render timestamp.

### Backend (`@kalebtec/docsxai-backend`)

- Stub service with the concrete REST endpoint list, bearer auth, in-memory linear immutable revisions. (Persistent backing + OAuth interactive flow are Phase 2.)

### Skill (`@kalebtec/docsxai-skill`)

- Vendorable `.claude/skills/` fallback delegating to the installed plugin.

### Cross-cutting

- Apache-2.0; OSS-clean; public-release-ready content (history scrubbed of client identifiers 2026-05-15).
- ~193 tests across the monorepo; typecheck clean; CI = typecheck + test on Node 20 / pnpm.
- Browxai is the canonical model-agnostic discovery driver (integration contract in `docs/browxai-asks.md`).
