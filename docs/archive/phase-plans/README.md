# `docs/archive/phase-plans/` — historical phase closure summaries

These are the impl-repo closure summaries for the original implementation phases. They mirrored the portfolio `roadmap.md` from `project-ideas/projects/automated-site-documentation-bot/` at the time each phase closed, and captured the lessons + scope-reshape rationale specific to the engine's evolution.

## What's here

- `PHASE-0.md` — Prototype & validation; closed 2026-05-15. Proves the architectural bet (engine never calls a model API; calibration→execution reproducibility holds) on a real authed heavy-SPA target.
- `PHASE-1.md` — MVP; closed 2026-05-19. Engine-complete + hardened; agent-integration-contract postmortem ("Stage-class pipeline was the wrong abstraction; write-time signal beats run-time control"); public OSS release prepared and owner-deferred.

## Status

**Archived, not deleted.** The phases themselves are long-closed; the canonical phase tracker is the portfolio `roadmap.md` and the running `progress.md` over in `project-ideas`. These files are kept here because:

1. The agent-integration-contract postmortem in `PHASE-1.md` is the load-bearing "why is the engine shaped like this" document — referenced from `AGENTS.md` and `docs/ai-context/architecture/surface-map.md`.
2. The Phase-0 closure narrative documents the exact set of artifacts and exit-criteria evidence that proved the architectural bet — useful when re-litigating any of those decisions.

## What lives elsewhere now

- **Current phase status, scope, exit criteria** → portfolio `projects/automated-site-documentation-bot/roadmap.md`
- **Cycle-by-cycle progress log** → portfolio `projects/automated-site-documentation-bot/progress.md`
- **Live agent guidance** → `docs/ai-context/`
- **Public adopter contracts** → `docs/agent-runbook.md`, `docs/actionability-contract.md`, `docs/browxai-asks.md`
