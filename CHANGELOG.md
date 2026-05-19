# Changelog

All notable changes to this project. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning is semver once the public release lands.

## [0.1.0] — UNRELEASED

> **Not yet published.** The repo is release-*prepared* but stays private; the public flip (npm publish + repo visibility + git tag) is deferred to ≥ Phase 3 by owner decision (2026-05-19). See [`RELEASE.md`](RELEASE.md) for the mechanical go-public checklist. This entry documents what `0.1.0` *will* ship.

The Phase-1 MVP: an LLM-agnostic engine + Claude Code plugin that walks a web app, follows written flows, and emits screenshot-rich docs. Calibration is AI-assisted and rare; execution is deterministic, agent-free, and CI-friendly.

### Engine (`@kalebtec/site-docs-engine`)

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

### Plugin (`@kalebtec/site-docs-plugin`)

- Claude Code plugin: `calibrate` + `diagnose` skills; `run` / `render` / `login` / `push` / `pull` commands.
- Static bundle validation (`validatePluginBundle`) cross-checked against the engine CLI surface.

### Viewer (`@kalebtec/site-docs-viewer`)

- Static HTML viewer: pulsing halo + numbered badges + Popper-placed callouts over clean screenshots; per-annotation `nudge`.
- Robust two-pass callout sizing measured on a `document.body`-attached probe (the callout is detached + `display:none` until `:hover` at build time, so an in-place measure bakes `width:0px` and collapses it to a one-character column); no-cache metas + visible render timestamp.

### Backend (`@kalebtec/site-docs-backend`)

- Stub service with the concrete REST endpoint list, bearer auth, in-memory linear immutable revisions. (Persistent backing + OAuth interactive flow are Phase 2.)

### Skill (`@kalebtec/site-docs-skill`)

- Vendorable `.claude/skills/` fallback delegating to the installed plugin.

### Cross-cutting

- Apache-2.0; OSS-clean; public-release-ready content (history scrubbed of client identifiers 2026-05-15).
- ~193 tests across the monorepo; typecheck clean; CI = typecheck + test on Node 20 / pnpm.
- Browxai is the canonical model-agnostic discovery driver (integration contract in `docs/browxai-asks.md`).
