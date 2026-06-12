# Maintainers

## Current maintainers

- **@rowinkaleb** (Rowin Hernandez, Kalebtec) — sole merge authority and sole release authority. Owns the engine, plugin, and backend surfaces.

Breakglass owner exists per universal-baseline A3. No further detail published.

## Backing

Kalebtec sponsors development time. docsxai is an Apache-2.0 licensed
project. The OSS engine + plugin + backend stub are the open surface;
a future commercial SaaS is the only place model-provider SDKs and
hosted deployment live, and it is not in this repo.

## How decisions are made

- The roadmap (in the `project-ideas` portfolio repo under
  `projects/automated-site-documentation-bot/`) defines committed
  direction.
- The portfolio `progress.md` and the archived closure summaries under
  `docs/archive/phase-plans/` record the _why_ behind each commitment.
- Owner direction settles open questions.
- Material spec changes require a roadmap entry before merge.

## Role notes

The repo has five packages with distinct shapes; in practice they are
all owned by the same maintainer today, but the boundaries matter for
review and contribution:

- **Engine** (`packages/engine/`) — the load-bearing surface. Every
  change here is reviewed against the two-mode architecture rule (no
  model API calls in the engine, deterministic replay byte-identical
  to source state).
- **Plugin** (`packages/plugin/`) — the Claude Code invocation
  surface. Changes here defer to engine semantics; new capability lives
  in the engine and the plugin exposes it.
- **Backend** (`packages/backend/`) — stub today, full service
  post-MVP. Auth + persistence shape is owner-decided.
- **Skill** (`packages/skill/`) — vendorable fallback. Stays minimal
  by design; delegates to the plugin.
- **Viewer** (`packages/viewer/`) — static-HTML emit surface. Changes
  here must not introduce runtime third-party CDN dependencies.

## How to influence direction

- Open an issue with a clear problem statement and reproducer.
- Substantial proposals get a portfolio-level decisions-log entry
  whether accepted or not.
- PRs against committed roadmap phases are highest-priority for
  review.

## Becoming a maintainer

Not currently open. After v1.0 ships, a contributor who has landed 5+
non-trivial PRs reviewed by the maintainer over 6+ months may open a
maintainer-track conversation. This is not a promise.

## Sponsorship / funding

None accepted today. No `.github/FUNDING.yml`. If that changes, it will
be announced via a roadmap phase, not a quiet PR.
