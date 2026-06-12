# Codex agent definitions — docsxai

Codex expert agents for this repo, in Codex's native TOML schema. Each file is the Codex-format mirror of the canonical Claude-skill version in `.agents/skills/<name>.md` — the role content is the same; only the wrapper format differs. Don't edit these in isolation: change `.agents/skills/<name>.md` first, then re-mirror.

The repo-root `AGENTS.md` is the single source of truth for cross-harness rules. These agents add role-specific framing on top of that base.

## Agents

- `command-author.toml` — Command / CLI / Plugin — adding a new `docsxai` CLI subcommand or a Claude Code plugin command.
- `plugin-feature-author.toml` — Plugin / Feature / Skill — adding a feature to the Claude Code plugin or the skill bundle.
- `keystone-writer.toml` — Keystone / Regression / Chromium — regression-gate keystone tests for runtime / actionability changes.
- `security-reviewer.toml` — Security / Egress / Auth — security checklist on workspace / auth-artifact / outbound-HTTP diffs.
- `docs-impact-auditor.toml` — Docs / Audit / Changelog — docs-impact verification on behavior-change diffs.
- `release-engineer.toml` — Release / Ship / Tag — the release ritual (owner-deferred until the public flip).
- `tracker-id-auditor.toml` — Tracker / Lint / Comments — scanning diffs for tracker IDs.

## See also

- `.agents/skills/<name>.md` — canonical Claude-skill version (source of truth).
- `.claude/agents/<name>.md` — Claude harness mirror (same `.md` shape).
- `AGENTS.md` — cross-harness rule base.
