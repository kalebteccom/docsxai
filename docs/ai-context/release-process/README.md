# Release process

The release path is gated and deferred — see [`RELEASING.md`](../../../RELEASING.md) at repo root for the go-public checklist. This subtree carries the agent-facing pieces.

- [`semver-clock.md`](semver-clock.md) — the API-stable-clock pre-1.0 governance.
- [`branch-protection.md`](branch-protection.md) — required GitHub branch-ruleset configuration. Stub today; the richer version matures in Phase D4.

Owner decision: the OSS release is **deferred to ≥ Phase 3**. This repo stays private/unpublished until the project is further along. The release pipeline (`release.yml`) is wired but `workflow_dispatch:`-only; the public flip is a deliberate later action.
