# Documentation contracts

docsxai has four documentation surfaces with distinct contracts. Mixing them is a docs-impact bug.

## `docs/` — public adopter contract

Repo-root markdown today; a published site lands later. Source of truth for what docsxai promises to its adopters.

- [`docs/agent-runbook.md`](../../agent-runbook.md) — the hand-to-an-agent calibration workflow.
- [`docs/running-against-an-app-repo.md`](../../running-against-an-app-repo.md) — human-readable runbook.
- [`docs/actionability-contract.md`](../../actionability-contract.md) — the portable `actionable()` predicate contract for browser-bridge consumers.
- [`docs/browxai-asks.md`](../../browxai-asks.md) — integration contract with the discovery driver.

**Every public behavior change updates the relevant page in the same diff.** Stale adopter docs poison integration.

## `docs/ai-context/` — agent-facing routing layer

This subtree. Not published. Read by agents (and contributors) working _on_ docsxai.

- **Discipline.** `agent-process/commit-discipline.md`, `code-quality.md`, `dist-rebuild-discipline.md`.
- **Architecture rationale.** `architecture/surface-map.md`, this file.
- **Lessons captured.** `secrets-and-egress/README.md` and future entries under `investigations/`.
- **Process.** `release-process/semver-clock.md`, `branch-protection.md`.
- **Field reports.** `adopter-reports/`, when they land.

## Colocated `README.md` — internal contracts

Per-package READMEs are internal architecture contracts.

- `packages/engine/README.md` — flow-file format, `BrowserDriver`, CLI command list.
- `packages/plugin/README.md` — Claude Code plugin commands + skills.
- `packages/backend/README.md` — REST surface, revision model.
- `packages/skill/README.md` — vendorable skill bundle.
- `packages/viewer/README.md` — `buildViewer`, `placeCallout`, the no-baked-annotations contract.

When refactoring a package, the colocated README travels with it.

## `AGENTS.md` — operating rules

Agent-agnostic, authoritative. Every harness loads this file. Per-harness pointers (`CLAUDE.md`, `.cursor/rules/00-substrate.mdc`, `.codex/config.toml`) reference it; they never duplicate content. Change a rule here and every harness picks it up on the next session.

## Portfolio repo — canonical spec + roadmap

[`projects/automated-site-documentation-bot/`](https://github.com/kalebteccom/project-ideas) in the `project-ideas` portfolio carries `spec.md`, `roadmap.md`, `progress.md`. **Source of truth for spec/scope.** Keep them in sync when implementation forces a design change; the impl repo's `PHASE-N.md` files mirror the portfolio `roadmap.md` for the agent-runtime context that doesn't belong upstream.

## What this means for a behavior-change diff

For a diff that touches the public surface:

1. Update the relevant runbook in `docs/`.
2. Update the package README if the package's promised surface changed.
3. Append an entry to `CHANGELOG.md` under `## Unreleased` in the right section.
4. Update `AGENTS.md` only if a cross-harness rule changed.
5. Mirror in the portfolio `progress.md` if scope or shape moved.

For a diff that touches discipline:

1. Update `AGENTS.md` if the rule applies cross-harness.
2. Update / add the relevant `docs/ai-context/agent-process/<topic>.md`.

For an internal refactor with no behavior change, write "no docs update required because <reason>" in the PR description. Silently skipping the docs-impact pass is a fail.
