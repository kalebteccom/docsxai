# Phase 0 — Prototype & validation

The design is locked (see `spec.md` Resolved questions in the `project-ideas` portfolio).
Phase 0 proves the locked design works in practice — a host agent (Claude Code) drives the
calibration pipeline via the skill-provider pattern with zero LLM calls from the engine, and
the resulting doc pack replays deterministically through headless execution — and completes
first-consumer coordination before MVP kickoff. Rough effort: ~3–4 weeks.

## Scope

- [ ] **Plugin packaging prototype** — git-URL `claude plugin install <git-url>` works; skills/commands/MCP register; runs from any cwd; `--persist tmp` works with no backend.
- [ ] **Backend stub + concrete API** — concrete endpoint list against the REST + per-resource shape (workspaces, projects, revisions, flow-files, screenshots, annotations, style artifacts, run history; OAuth-2.1 / bearer-token auth; versioning header). Minimal local stub running.
- [ ] **Target-site auth plumbing** — `auth/strategy.yaml` parser + Playwright `setup`-project consumption path + a *scaffolding* strategy (`api-login` against a public toy site, or a static-`storageState` fixture). Discovery → `storageState` → headless-`run` handoff validated end-to-end. (The the first consumer-specific strategy is built after the first-consumer conversation; doesn't gate this.)
- [ ] **Flow-file parser + round-trip** — YAML flow-file parser/runtime; benchmark against the the first-consumer testing guide; a sample flow round-trips calibrate → run.
- [ ] **Calibration → execution reproducibility keystone** — plugin-driven calibration produces a doc pack; a second `/site-docs run` on a fresh process, no agent context, authenticating via the scaffolding strategy, reproduces the docs deterministically.
- [ ] **Ambiguity-signalling contract under stress** — implement the pause/resume discriminated-union contract; run calibration with a deliberately under-specified flow; engine surfaces ambiguity cleanly, host agent resolves, pipeline continues.
- [ ] **Annotation renderer prototype** — clean screenshot + `annotations.json` + Vitest viewer overlaying arrows/popups at render time.
- [ ] **Style-artifact trial** — plugin asks Claude Code to extract style from a sample doc, persists YAML + derived JSON, a second run consumes it.
- [ ] **first-consumer coordination** — run the `first-consumer-prep.md` conversation: site-access model, Claude-in-Chrome security posture, **the target app's login scheme** (→ MVP auth strategy), test-only login endpoint, Confluence delivery space + credentials; import + review the Recap flow guide.

## Exit criteria

- [ ] Claude Code, via the installed plugin, drove a ≥3-step calibration end-to-end against a test site with **zero LLM-provider calls from the engine or backend**.
- [ ] **Calibration → execution reproducibility (the keystone).** After calibration, a second `/site-docs run` on a fresh process with no agent context — authenticating via the scaffolding auth strategy from a captured/generated `storageState` — produces an identical doc pack (modulo runtime timestamps). *MVP cannot start without this.*
- [ ] Plugin installs cleanly via git-URL `claude plugin install` on a fresh Claude Code install, runs from any cwd (incl. empty dirs), `--persist tmp` works with no backend.
- [ ] Concrete backend API endpoint list committed; minimal stub backend running.
- [ ] Target-site auth plumbing validated: `auth/strategy.yaml` parsed, `setup`-project path works, discovery → `storageState` → headless-`run` handoff works end-to-end with the scaffolding strategy.
- [ ] A sample flow in the YAML flow-file format round-trips calibrate → run correctly.
- [ ] Under-specified calibration test: engine surfaced ambiguity via the pause/resume contract for ≥1 step, host agent resolved, pipeline continued.
- [ ] Vitest viewer renders arrows + popups from `annotations.json` correctly on the test site.
- [ ] Style artifact produced, hand-edited, re-applied correctly on a second run.
- [ ] first-consumer coordination done: the target app's login scheme identified (→ MVP auth strategy chosen), site-access plan agreed, Confluence delivery target confirmed, Recap flow guide imported + reviewed for format fit.

## Deliverables

- Spike report (what works / what's brittle / where Claude Code struggles) — explicit sections on the ambiguity contract under under-specified inputs, and on the discovery → `storageState` handoff.
- End-to-end demos: calibrate → headless-`run` reproducibility; annotation rendering; style-artifact round-trip.
- Concrete backend API endpoint list + running stub.
- first-consumer coordination outcomes captured (`first-consumer-prep.md` checklist completed).
- Updated portfolio `spec.md` for any design adjustments the prototype forces.
