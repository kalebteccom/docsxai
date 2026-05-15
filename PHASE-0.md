# Phase 0 — Prototype & validation

**Status: CLOSED 2026-05-15 — full win.** Phase 0's job was to prove the locked design works in practice — a host agent drives the calibration pipeline via the skill-provider pattern with zero LLM calls from the engine, and the resulting doc pack replays deterministically through headless execution. **Both bets are validated.** The 2026-05-15 re-adoption run against an authed heavy-SPA target authored a new flow file end-to-end through the agent surface, and `site-docs run` replayed it deterministically (no agent, no MCP, no LLMs). What's left from the original Phase-0 scope is documented below; nothing remaining is architecture-blocking.

## What Phase 0 proved

1. **The architectural bet holds.** The engine never calls a model API. A host agent (Claude Code, via browxai's MCP surface) supplies all inference; the engine orchestrates. The 2026-05-15 calibration round wrote `recap-edit-timing.flow.yaml` from the live target's a11y+DOM-walk snapshot, transcribed selectors mechanically from `find().selectorHint`, used `await_human({kind:"acknowledge"})` for human checkpoints, and resolved actionability ambiguities (start-time inputs found to be `disabled`) in-flight.
2. **Calibration → execution reproducibility holds.** That same flow ran cleanly through `site-docs run` headless, against the cached `storageState`, no agent in the loop. The doc pack (flow-file + `annotations.json` + screenshots + halts) is self-sufficient for execution.
3. **Target-site auth works end-to-end on a real authed target.** `capture-auth` over `--cdp` Chrome → instrumented login → `storageState` cached locally with `auth_cookie` pinned to the real session cookie → `site-docs run` replays until cookie expires → re-capture. The full `manual-capture` ↔ `run` handoff cycled multiple times across the 2026-05-13 → 2026-05-15 rounds.
4. **Ambiguity surfaces and resolves cleanly.** Under-specified inputs (icon-only tabs, hidden-duplicate testids, content-keyed asset IDs, disabled inputs) all surfaced as agent-visible signals (`stability: "low"`, `multiple-matches`, `[from-dom]` markers, halt-cause prefix `[target is disabled]`) and were resolved either by the agent in-flight or by the runbook's documented locator idioms.

## Setup (still useful for fresh checkouts)

```bash
corepack enable && pnpm install
pnpm -C packages/engine exec playwright-core install chromium
pnpm -r typecheck && pnpm -r test
```

## Build status at close

Engine/backend/viewer/plugin/skill, **116 vitest tests in the engine + 22 across the other packages = 138 total**, typecheck clean, CI green on Node 20 / pnpm.

- **engine** — doc-pack zod schemas; flow-file parser/validator/serializer (`extends` composition; cycle / step-id-collision rejection); pause/resume pipeline contract (`StageResult` / `Ambiguity` / `Resolution`); auth layer (`AuthStrategy` interface, `auth/strategy.yaml` parser, `resolveCredsEnv`, `LocalStorageStateCache`, `manual-capture` over an `InstrumentedBrowser` abstraction with `auth_cookie` pinning, persistent profile, `--cdp` attach); flow-runtime (`runFlow` resolving locators, running actions, applying waits, checking success, halting with `[cause: …]` prefix + halt-screenshot path, emitting `annotations.json`; `startFrom` for sub-3-sec iteration; `stopAfter` for calibration; concurrency with isolated sessions); `BrowserDriver` interface with `actionable()` predicate (`docs/actionability-contract.md`); `PlaywrightDriver` + `launchPlaywrightSession` (CDP attach with not-owned semantics) + `PlaywrightInstrumentedBrowser`; `initWorkspace` + `.site-docs.json` workspace config; `calibrate` (structured-input → flow-file); the **`site-docs` CLI** — `init` / `calibrate` / `run` (with `--start-from` / `--cdp` / `--concurrency` / `--pause` / `--stop-after`) / `render` / `capture-auth` / `inspect` / `lint` / `flow-tree`.
- **docs** — `docs/agent-runbook.md` (the hand-to-an-agent runbook; surfaces `lint` / `flow-tree` / halt-cause prefix / `--start-from --cdp` / annotation `nudge`); `docs/browxai-asks.md` (the cross-repo integration contract with browxai, 16 asks, status: closed); `docs/actionability-contract.md` (the portable predicate contract for browxai-consumer mirroring); `docs/running-against-an-app-repo.md` (human runbook).
- **backend** — REST endpoint list (`api.ts` `ROUTES`), in-memory store (linear immutable revisions), HTTP stub server (bearer auth + version header).
- **viewer** — `buildViewer` static HTML + `OVERLAY_JS` (halo + numbered badge + Popper-placed callout with `nudge` offset).
- **plugin** — `.claude-plugin/plugin.json`, `commands/`, `skills/calibrate/SKILL.md` (references `<browxai>/AGENT-RUNBOOK.md` as the canonical operational source rather than duplicating).
- **skill** — vendorable fallback + `vendorSkill()`.
- **keystone** — `test/keystone.test.ts` runs the fixture flow against `test/fixtures/toy-site` via real Chromium, twice, asserting byte-identical structured artifacts.

## Exit criteria — final state

- [x] **Agent drove a ≥3-step calibration end-to-end with zero LLM-provider calls from engine or backend.** Validated 2026-05-15 via the browxai re-adoption: `recap-edit-timing.flow.yaml` authored end-to-end through the MCP surface (≥4 steps including extends preamble). Original wording presumed the implementation shape would be in-repo `DiscoveryStage`/`MappingStage`/`CommitStage` + a `site-docs-mcp` server; **that specific shape didn't ship and isn't needed** — browxai's curated MCP surface + the calibrate-skill playbook cover the same architectural territory.
- [x] **Calibration → execution reproducibility (the keystone).** Holds end-to-end against the toy site (`test/keystone.test.ts`, scaffolding, 2 reproducible runs) AND on a real authed target (2026-05-15 round: agent-authored flow → `site-docs run` headless → clean replay).
- [x] **Concrete backend API endpoint list + minimal stub backend.** `api.ts` `ROUTES` + `createBackendStub` / `site-docs-backend` bin.
- [x] **Target-site auth plumbing validated end-to-end.** `auth/strategy.yaml` parsed; `manual-capture` strategy cycled through real interactive logins + replay-until-expiry + re-capture across multiple rounds; `auth_cookie` pin tracks the real session cookie; `--cdp` attach shares one Chrome between `capture-auth` and the discovery driver (one login, not two).
- [x] **Sample flow round-trips in the YAML flow-file format.** Plus `extends` composition, step-id-uniqueness across the merged chain, locator-ref resolution, cycle rejection.
- [x] **Ambiguity-signalling contract validated under stress.** Real round-3 calibration surfaced hidden-duplicate `[data-foo]` matches, disabled inputs, content-keyed testids that look stable per-snapshot but rotate per-deploy, and icon-only tabs whose `title=` isn't a `find()` query target — all resolved by the agent via the documented locator idioms + `actionable()` / `inferHaltCause` vocabulary.
- [x] **Viewer renders arrows + popups from `annotations.json` correctly.** Plus numbered badges, Popper-placed callouts, per-annotation `nudge` for overlap-resolution.

## Slid to Phase 1 (not Phase-0 gates)

- **Plugin install end-to-end validation.** `claude plugin install <git-url>` on a fresh Claude Code install, runs from any cwd, `--persist tmp` works with no backend. Scaffold built; no architectural risk; needs a fresh Claude Code install to exercise. Early Phase-1 polish.
- **Style-artifact agent loop.** Schema + persistence exist; the host-agent-driven style-discovery cycle + a second-run consumption demo aren't built. Pure orchestration work, no architectural unknowns. Early Phase-1.

## What didn't ship (and why it's OK)

- **First-consumer coordination conversation** — obsoleted. The existing Kalebtec ↔ first-consumer engagement covers what the conversation was scoped to settle (account provisioning, network access, security posture, delivery target, recalibration cadence). The portfolio-side `wsc-conversation-prep.md` was deleted 2026-05-15. Decision recorded in `projects/automated-site-documentation-bot/spec.md` and `roadmap.md` in the portfolio.
- **`DiscoveryStage` / `MappingStage` / `CommitStage` as in-repo code abstractions + a `site-docs-mcp` server.** Originally scoped as the Phase-0 implementation shape. Browxai's MCP surface plus the calibrate-skill playbook turned out to cover the same ground architecturally; building bespoke stage classes would have duplicated browxai's `find()` / `snapshot()` / `await_human()` work. The design lesson: agent orchestration belongs in the agent's tooling layer, not in a separate stage runtime in the engine.

## Deliverables

- ✅ Engine / backend / viewer / plugin / skill, 138 tests, typecheck-clean, CI green.
- ✅ Calibrate → headless-`run` reproducibility demonstrated end-to-end on a real authed target.
- ✅ Annotation rendering (clean PNG + `annotations.json` + viewer with halo + numbered badge + Popper callout + nudge).
- ✅ Concrete backend API endpoint list + running stub.
- ✅ Browxai integration contract closed (`docs/browxai-asks.md`); actionability contract documented (`docs/actionability-contract.md`).
- ➤ Phase-0 spike report compressed into this doc + the portfolio progress entries 2026-04-23 through 2026-05-15.
