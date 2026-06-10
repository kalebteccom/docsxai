# `docs/archive/` — historical implementation artifacts

This subtree holds historical documents that captured the shape of the project at a specific point in time. They are **not** live references — the canonical specs they once mirrored have moved on. Keep them for context, design rationale, and "why is this code shaped the way it is" archaeology.

## What lives here

| Subdir         | Contents                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase-plans/` | Closure summaries for the original implementation phases (0, 1, …). Mirrored the portfolio `roadmap.md` at the time; today the portfolio spec + `progress.md` is the canonical project record. |

## What does **not** live here

- **Live agent guidance** belongs in `docs/ai-context/` — that subtree is read by every agent session and stays current with the code.
- **Public adopter runbooks** (e.g. `docs/agent-runbook.md`, `docs/running-against-an-app-repo.md`) stay in `docs/` and are versioned with the surface.
- **Release procedure** lives in `RELEASING.md` at the repo root.

## Why an archive

Phase-closure documents accumulate detail that's valuable later — the agent-integration-contract postmortem in `phase-plans/PHASE-1.md` is the single best source for _why_ the engine never calls a model API and why write-time signal beats run-time control. Deleting that history loses signal; leaving it at the repo root implies it's still operational. The archive is the third way.

When a document graduates from "live reference" to "historical record," move it here and update the references that still point at the old path.
