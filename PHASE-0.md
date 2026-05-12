# Phase 0 — Prototype & validation

The design is locked (see `spec.md` Resolved questions in the `project-ideas` portfolio).
Phase 0 proves the locked design works in practice — a host agent (Claude Code) drives the
calibration pipeline via the skill-provider pattern with zero LLM calls from the engine, and
the resulting doc pack replays deterministically through headless execution — and completes
first-consumer coordination before MVP kickoff. Rough effort: ~3–4 weeks.

## Setup

```bash
corepack enable && pnpm install
pnpm -C packages/engine exec playwright-core install chromium   # needed for `site-docs run`, `capture-auth`, and the keystone test
pnpm -r typecheck && pnpm -r test
```

## Build status (live)

What's real in the repo so far (the engine/backend/viewer/plugin/skill code, **53 vitest tests**, typecheck clean, CI = typecheck + test on Node 20 / pnpm):

- **engine** — doc-pack zod schemas; flow-file parser/validator/serializer; pause/resume pipeline contract (`StageResult` / `Ambiguity` / `Resolution`); auth layer (`AuthStrategy` interface, `auth/strategy.yaml` parser, `resolveCredsEnv`, `LocalStorageStateCache`, **`manual-capture`** over an `InstrumentedBrowser` abstraction, `makeStrategy`); flow-runtime (`BrowserDriver` abstraction + `runFlow` — resolves locators, runs actions, applies waits, checks success, halts on failure, re-captures screenshots, emits `annotations.json`); `PlaywrightDriver` + `launchPlaywrightSession` + `PlaywrightInstrumentedBrowser` (security-lowered, instrumented); the **`site-docs` CLI** — `run` (wired end-to-end: flows + `.auth` cache → Chromium → `runFlow` → re-emit), `render` (shells out to the viewer), `capture-auth` (runs the role's strategy — `manual-capture` spawns the instrumented browser → engineer logs in → console/button capture → caches to `.auth/<role>.json`), `--help`.
- **backend** — concrete REST endpoint list (`api.ts` `ROUTES`), in-memory store (linear immutable revisions, artifact slots), HTTP stub server (bearer-token gate, `Site-Docs-API-Version` echo/warn), `createBackendStub` + the `site-docs-backend` bin.
- **viewer** — `buildViewer` (static HTML; overlays arrows/popups from `annotations.json` at render time; HTML-escaped; copies clean screenshots) + the `site-docs-viewer` bin.
- **plugin** — `.claude-plugin/plugin.json`, `commands/{run,render,login}.md`, `skills/{calibrate,diagnose}/SKILL.md` (the calibrate skill carries the discovery→mapping→commit playbook), a TS surface (`readManifest`/`listCommands`/`listSkills`).
- **skill** — the vendorable `skill/site-docs/SKILL.md` fallback + `vendorSkill()`.
- **keystone** — `test/keystone.test.ts` runs the fixture flow against `test/fixtures/toy-site` via real Chromium, twice, and asserts byte-identical structured artifacts + present screenshots. Passes with a browser installed (skips otherwise). Validates the determinism property end-to-end with a *scaffolding* setup (public toy site, no auth); the full criterion (`/site-docs run` + the `manual-capture` strategy against an authed site) is wired (`capture-auth` + `run`) but not in an automated test (needs a human login).

**Not built yet:** the calibration pipeline stage *implementations* (`DiscoveryStage`/`MappingStage`/`CommitStage` — only the contract exists; these are the part most entangled with the live-agent loop); the `site-docs-mcp` internal MCP server; `publish`/`edit`/`push`/`pull` commands + `--persist tmp` + wiring `run` to record run-revisions in the backend; the `style-learn`/`translate` skills. Plus everything that needs a live Claude Code session or the first consumer (see the unchecked exit criteria below).

## Scope

- [ ] **Plugin packaging prototype** — scaffold built (`.claude-plugin/plugin.json`, `commands/`, `skills/`); the `claude plugin install <git-url>` end-to-end / "registers + runs from any cwd" / `--persist tmp` validation needs a fresh Claude Code install and isn't done. Manifest schema needs confirming against current plugin docs.
- [x] **Backend stub + concrete API** — `api.ts` `ROUTES` is the concrete endpoint list; in-memory stub server runs (bearer-token gate, version header, linear immutable revisions). `site-docs-backend` bin.
- [x] **Target-site auth plumbing** — `auth/strategy.yaml` parser; `manual-capture` over an `InstrumentedBrowser`; `PlaywrightInstrumentedBrowser` (security-lowered, instrumented, console + button triggers); `LocalStorageStateCache` (TTL-aware); `site-docs capture-auth` (runs the strategy → caches `.auth/<role>.json`) → `site-docs run` consumes it via `launchPlaywrightSession({ storageState })`. The handoff *path* is wired; the discovery *stage* that feeds it (and the under-specified-input ambiguity exercise) isn't built. (Other catalogue strategies + `store: backend` are Phase 2+.)
- [x] **Flow-file parser + round-trip** — YAML parser/validator/serializer (locator-ref + dup-id checks); round-trips; a fixture flow runs through `runFlow` against a real browser. (Benchmarking against the the first-consumer testing guide is pending the guide import.)
- [x] (scaffolding) **Calibration → execution reproducibility keystone** — `test/keystone.test.ts` runs the fixture flow against the toy site via real Chromium, twice, asserting byte-identical structured artifacts. Validates the determinism property end-to-end with a scaffolding setup (public toy site, no auth); the full criterion (`/site-docs run` + `manual-capture` against an authed site) is wired but not auto-tested, and a *plugin-driven* calibration producing the doc pack needs the calibration stages + a live agent.
- [ ] **Ambiguity-signalling contract under stress** — the pause/resume contract types exist (`pipeline.ts`); the under-specified-input run needs the calibration stage implementations + a live agent.
- [x] **Annotation renderer prototype** — `buildViewer` emits static HTML overlaying arrows/popups from `annotations.json` at render time (HTML-escaped, clean screenshots copied); `site-docs render` shells out to it. (Rendering against a real captured screenshot is exercised in the keystone path; the viewer test asserts the overlay markup directly.)
- [ ] **Style-artifact trial** — the style-artifact schema + persistence exist (`doc-pack.ts`); the agent extraction loop + a second-run consumption demo aren't built.
- [ ] **first-consumer coordination** — run the `first-consumer-prep.md` conversation: calibration access (UAT account, network), security posture for the host-spawned instrumented Chrome + Claude in Chrome, the auth-mode operational follow-ups (Azure AD SSO is confirmed; ask about a callable login path / test-only login endpoint — either makes it unattended), data posture, Confluence delivery space + credentials; import + review the Recap flow guide.

## Exit criteria

- [ ] Claude Code, via the installed plugin, drove a ≥3-step calibration end-to-end against a test site with **zero LLM-provider calls from the engine or backend**. *(Needs a live Claude Code session driving the `calibrate` skill — and the calibration stage implementations, which aren't built yet.)*
- [ ] **Calibration → execution reproducibility (the keystone).** After calibration, a second `/site-docs run` on a fresh process with no agent context — authenticating via the `manual-capture` strategy from a cached `storageState` — produces an identical doc pack (modulo runtime timestamps). *Substantially done:* the determinism property holds end-to-end against a real browser (`test/keystone.test.ts`) with a scaffolding setup (toy site, no auth); still needs (a) the doc pack to come from a *plugin-driven calibration* and (b) the authed-site `/site-docs run` + `manual-capture` path exercised. *MVP cannot start without the full version.*
- [ ] Plugin installs cleanly via git-URL `claude plugin install` on a fresh Claude Code install, runs from any cwd (incl. empty dirs), `--persist tmp` works with no backend. *(Scaffold built; not yet validated against a real install; `--persist tmp` not yet implemented.)*
- [x] Concrete backend API endpoint list committed; minimal stub backend running. *(`api.ts` `ROUTES` + `createBackendStub` / `site-docs-backend` bin; 5 tests.)*
- [ ] Target-site auth plumbing validated: `auth/strategy.yaml` parsed, the captured-session consumption path works, the `manual-capture` strategy works (instrumented Chrome spawned, interactive login, console/button capture, local cache, TTL expiry → re-capture prompt), discovery → `storageState` → local-`run` handoff works end-to-end. *(All the code exists + unit-tested; the *end-to-end* validation — a real interactive capture feeding a real `run` — needs a target site + a human, and the discovery stage that feeds it isn't built.)*
- [x] A sample flow in the YAML flow-file format round-trips correctly. *(parse→serialize→parse round-trip test; the fixture flow runs through `runFlow` against real Chromium in the keystone test.)*
- [ ] Under-specified calibration test: engine surfaced ambiguity via the pause/resume contract for ≥1 step, host agent resolved, pipeline continued. *(Contract types exist; needs the calibration stages + a live agent.)*
- [x] Viewer renders arrows + popups from `annotations.json` correctly. *(`buildViewer`; viewer test asserts the overlay markup + screenshot copy; the OVERLAY_JS positions box + callout from the embedded annotation at render time.)*
- [ ] Style artifact produced, hand-edited, re-applied correctly on a second run. *(Schema + persistence exist; the agent extraction loop isn't built.)*
- [ ] first-consumer coordination done: Azure AD SSO details confirmed (+ a yes/no on a callable login path / test-only login endpoint), site-access plan agreed, security posture for the instrumented Chrome + Claude in Chrome confirmed, data posture agreed, Confluence delivery target confirmed, Recap flow guide imported + reviewed for format fit. *(Needs the first-consumer conversation — see `first-consumer-prep.md`.)*

## Deliverables

- Spike report (what works / what's brittle / where Claude Code struggles) — explicit sections on the ambiguity contract under under-specified inputs, and on the discovery → `storageState` handoff.
- End-to-end demos: calibrate → headless-`run` reproducibility; annotation rendering; style-artifact round-trip.
- Concrete backend API endpoint list + running stub.
- first-consumer coordination outcomes captured (`first-consumer-prep.md` checklist completed).
- Updated portfolio `spec.md` for any design adjustments the prototype forces.
