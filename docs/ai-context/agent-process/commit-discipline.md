# Commit discipline

Conventional-commit subjects, **≤72 characters**. A body and trailers are allowed; no attribution line is required or forbidden. Enforced by [`.claude/hooks/block-long-commits.sh`](../../../.claude/hooks/block-long-commits.sh) on visible `git commit -m` / `--message=` invocations, where `git commit` counts only as a command word (not inside quoted text or an echo). Codex hooks and `.githooks/commit-msg` mirror the same checks; merge commits (`MERGE_HEAD` present or a subject starting `Merge `) are exempt. `pnpm test:hooks` runs a sample-message matrix against all three.

## Subject format

`type(scope): subject` or `type: subject`. Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

## What goes in the commit, what goes elsewhere

- Subject: what changed, in 72 chars.
- The _why_: a body after a blank line, the PR description, a CHANGELOG entry or the relevant `docs/ai-context/` note.
- No bug-tracker links in the subject.

## Staging

Stage files explicitly: `git add <paths>`. Never `git add .` or `git add -A`, since it sweeps in secrets, generated artifacts, and unrelated workspace junk. The repo's `.prettierignore` and `.gitignore` are belt-and-braces, not substitutes for explicit staging.

## No internal tracker IDs in source or comments

Ticket / plan / round / PR refs (`W-X#`, `Round-N`, `ask #N`, `TICKET-N`, `JIRA-N`, `#1234`, `ROLLBACK-SAFETY-PLAN`, etc.) are project-management artifacts, not code context. They rot, mean nothing to a future reader, and belong in the commit/PR body. State the actual reason instead: write _why_ the code is the way it is, not _which ticket asked for it_.

**Exception.** Load-bearing identifier schemes tied to enforcing tests (e.g. an `INV-N` invariant tag whose literal text the test discovers). docsxai has none today; the rule shape is documented so future invariant work doesn't blow up the auditor.

A PR-time `tracker-id-auditor` agent (see [`../../../.agents/skills/tracker-id-auditor.md`](../../../.agents/skills/tracker-id-auditor.md)) regex-scans diffs as a backup.

## Cycle boundaries

A cycle = any logically complete unit of change: a phase transition, a refinement round, an open-question close-out, a single tooling-layer bring-up, a single governance-doc set. One cycle → one commit, pushed. Don't batch a week of work into one commit. Per-cycle history is the point.

## Signing

The repo requires signed commits on `main` (server-side). Sign locally. Never use `-c commit.gpgsign=false` or any signing bypass. If signing fails, fix the local key configuration. Don't disable the requirement.

## Related

- [`code-quality.md`](code-quality.md): the full quality gate.
- [`dist-rebuild-discipline.md`](dist-rebuild-discipline.md): verify before push.
