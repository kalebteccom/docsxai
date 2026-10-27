# Release process

The release path is gated, see [`RELEASING.md`](../../../RELEASING.md) at repo root for the release checklist. This subtree carries the agent-facing pieces.

- [`semver-clock.md`](semver-clock.md): the API-stable-clock pre-1.0 governance.
- [`branch-protection.md`](branch-protection.md): branch-ruleset configuration for `main`, with the Woodpecker status as the required check.
- [`retired-registry-pattern.md`](retired-registry-pattern.md): graceful deprecation for operator-facing inputs (flow-file fields, CLI flags, strategy names, capability strings): retired → accept+warn+ignore; never-valid → loud error; removal only at a major.

The repo is public; `0.2.0` is on npm's `latest` tag and `0.3.0-rc.3` on `next`; 1.0 is the stability milestone (see `semver-clock.md`). Releases run only in `.woodpecker/release.yaml`, a workflow on the `manual` event: it stages the seven packages with a stage-only npm token (no provenance), and the owner approves each staged version with 2FA (see `RELEASING.md`). No GitHub Actions workflow remains.
