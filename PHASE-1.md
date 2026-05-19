# Phase 1 — MVP

**Status: CLOSED 2026-05-19 — engine-complete; public release prepared, deferred to ≥ Phase 3.** Phase 1's job was to ship a usable engine + plugin + minimal backend that documents a real consumer's feature area end-to-end via plugin-driven calibration, with deterministic agent-free replay, in zip + interactive-viewer formats. **The engine is done and hardened**; the two non-engine criteria (full-feature-area reviewer acceptance; the public OSS release) are deferred for reasons that are *not* engine gaps — documented below. Canonical phase tracker is the portfolio `roadmap.md`; this is the impl-repo mirror (same role `PHASE-0.md` plays for Phase 0).

## Exit criteria — final state

- [x] **Calibration documents flows end-to-end, structured + loose variants.** Validated repeatedly against a real authed heavy-SPA across the 2026-05-13 → 2026-05-19 rounds: agent-authored flows from live-page discovery, both input shapes exercised.
- [~] **All 12 feature-area flows.** ~2 calibrated in the live consumer workspace; the remaining breadth is engagement-bound (target access + reviewer cycle), not an engine limitation. Explicitly deferred to the engagement, per the owner's standing "don't couple a code milestone to an engagement we don't control" call (same rationale as Phase-0 close).
- [x] **Deterministic CI run** — `site-docs run` + `render` headless, no agent context, no LLM calls; byte-identical re-runs (keystone test, real Chromium).
- [x] **`site-docs diagnose`** against a forced failure proposes typed recalibration recommendations.
- [x] **Output zip usable as-is** — `site-docs zip`; verified clean (no `.auth/`/halts/`.viewer/`) on real handoff packs.
- [x] **Interactive viewer renders correctly** — halo + numbered badges + Popper callouts; the WebKit min-content-collapse callout bug found + fixed via two-pass sizing; no-cache metas + render timestamp.
- [x] **Skill-provider mode; zero LLM-provider calls from engine/CLI/skill** — validated; the engine never imports a provider SDK.
- [x] **Semantic reshape validated** — `site-docs style --check` jargon scanner; clean on real flows.
- [x] **Style artifact produced / hand-edited / re-applied** — schema + persistence + derived JSON + init/validate CLI. (The agent-driven *extraction* loop runs at calibration time; engine side complete.)
- [x] **Hand-edited flow-file round-trips** — parser preserves; exercised every calibration round (hand-edit → `run` → docs regenerate).
- [↗] **OSS repo tagged `0.1.0` under Apache-2.0.** **Release-prepared, publish deferred to ≥ Phase 3 by owner decision (2026-05-19).** Apache-2.0 in place, READMEs/CONTRIBUTING/CHANGELOG written, npm metadata on every package, history scrubbed, versions at `0.1.0`, `"private": true` guards on. The flip is mechanical — see [`RELEASE.md`](RELEASE.md). Not an engine gap.

## Closure narrative

Phase 0 proved the *architecture*; Phase 1 made it a *usable tool*. Every engine-shape exit criterion is met. What's open is not the engine: full-feature-area breadth needs the consumer engagement (target access, reviewer sign-off); the public release is a deliberate owner deferral to ≥ Phase 3 (don't maintain a public API + semver obligations through Phase-2 churn — GitHub App, engine-side Confluence push, standalone MCP server). Marking those `[~]`/`[↗]` rather than fake-checking them keeps the closure honest, same discipline as Phase-0 close.

A large fraction of nominal Phase-1 scope was pulled forward during Phase-0 polish (the CLI surface, viewer, auth, backend stub). The genuinely-new Phase-1 work was: `diagnose`, the style/jargon enforcement, `zip`, the plugin↔backend wiring + static validation, the `optional:true` conditional-UI primitive, and the OSS-release prep — all shipped.

## Internal postmortem — the agent-integration contract

The Phase-1 deliverable "what we'd change about the agent-integration contract":

1. **The Stage-class pipeline (`DiscoveryStage`/`MappingStage`/`CommitStage`) was the wrong abstraction and we were right to drop it.** The original design put the agent-orchestration loop *inside the engine* as resumable stage objects. In practice, browxai's MCP surface + the calibrate-skill playbook covered the same ground without a bespoke in-engine state machine. Lesson: agent orchestration belongs in the agent's tooling layer, not duplicated in the engine. The engine's job is the deterministic floor (parse, run, emit) + write-time signal (`actionable()`, `lint`, `diagnose`); the *inference loop* is the host agent's.
2. **The most valuable contract surface turned out to be write-time signal, not run-time control.** `actionable()`, the halt-cause prefix, `lint`, `diagnose`, `flow-tree` — these let the calibration agent decide *before* committing a step whether it'll hold. That class of affordance (lift failures from run-time to write-time) returned far more than any pause/resume control-flow protocol. Future contract work should bias here.
3. **Conditional UI was an unforeseen first-class need.** The flow-file format assumed every step always happens. Real targets have modals-that-sometimes-appear, first-run tooltips, cookie banners. We shipped `optional: true` after an agent hacked it with a permissive comma-selector. Lesson: "the happy path always happens" is a wrong default for real SPAs; the format needs explicit affordances for conditional/optional UI from the start.
4. **Cross-tool helper lifecycle is a real seam.** The `__siteDocs_capture` / `__browx_send` shared-CDP binding errors recurred until both tools made their injected page helpers self-clean on detach. Lesson: any injected page helper must assume its backing binding can vanish under it (multi-client CDP) and degrade to a logged no-op, not throw.
5. **Browser-driver decoupling paid off.** Keeping the engine behind a `BrowserDriver` interface (vs. hard-wiring Playwright) is what let browxai slot in as the model-agnostic discovery driver. The one place we touch Playwright (`PlaywrightDriver`) stayed small. Keep this boundary sharp in Phase 2.

## What's deferred (and why it's not an engine gap)

- **Full 12-flow feature-area deliverable accepted by a reviewer** — engagement-bound. Needs target access + the reviewer cycle. The engine demonstrably calibrates + replays flows on the real target; breadth is throughput, not capability.
- **Public OSS release (`0.1.0` tag, npm publish, repo visibility)** — owner-deferred to ≥ Phase 3. Repo is one mechanical flip from public; see `RELEASE.md`.
- **Backend persistent store + OAuth interactive flow + hosted deployment** — Phase 2 (the stub is sufficient for MVP; not a Phase-1 exit criterion).

## Next: Phase 2

Per the portfolio roadmap: GitHub App (packaged CI), engine-side Confluence push + burned annotations, standalone MCP server, additional feature areas, disambiguation UX hardening. Phase-2 scoping is the next planning cycle.
