# Release process

The release path is gated — see [`RELEASING.md`](../../../RELEASING.md) at repo root for the release checklist. This subtree carries the agent-facing pieces.

- [`semver-clock.md`](semver-clock.md) — the API-stable-clock pre-1.0 governance.
- [`branch-protection.md`](branch-protection.md) — required GitHub branch-ruleset configuration. Stub today; the richer version matures at the public flip.
- [`retired-registry-pattern.md`](retired-registry-pattern.md) — graceful deprecation for operator-facing inputs (flow-file fields, CLI flags, strategy names, capability strings): retired → accept+warn+ignore; never-valid → loud error; removal only at a major.

The repo is public; `0.2.0` is on npm's `latest` tag and `0.3.0-rc.2` on `next`; 1.0 is the stability milestone (see `semver-clock.md`). The release pipeline (`release.yml`) publishes on `v*.*.*` tag pushes only; its `workflow_dispatch` trigger runs a dry-run job that cannot publish (see `RELEASING.md`).
