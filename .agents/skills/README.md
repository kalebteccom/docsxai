# Shared agent skills — docsxai

Cross-harness shared definitions. `AGENTS.md` (repo root) is the operating rules; this directory holds reusable per-domain skill / agent definitions that every harness adapter draws from.

Today's scope: the seven expert agents listed below. docsxai does not yet have a corpus of additional shared skills — this is the substrate for future ones.

## Convention

- One file per role: `<role-name>.md` (kebab-case).
- YAML frontmatter declares `name`, `description`, `model`, `tools`.
- Body: role definition, scope, success criteria, what NOT to do.
- The Claude and Codex agent registries (`.claude/agents/`, `.codex/agents/`) mirror these files. Treat this directory as the source of truth; the mirrors are convenience copies for harness auto-discovery.

## Agents

- `command-author.md` — Command / CLI / Plugin — adding a new `site-docs` CLI subcommand or a Claude Code plugin command.
- `plugin-feature-author.md` — Plugin / Feature / Skill — adding a feature to the Claude Code plugin or the skill bundle.
- `keystone-writer.md` — Keystone / Regression / Chromium — regression-gate keystone tests for runtime / actionability changes.
- `security-reviewer.md` — Security / Egress / Auth — security checklist on workspace / auth-artifact / outbound-HTTP diffs.
- `docs-impact-auditor.md` — Docs / Audit / Changelog — docs-impact verification on behavior-change diffs.
- `release-engineer.md` — Release / Ship / Tag — the release ritual.
- `tracker-id-auditor.md` — Tracker / Lint / Comments — scanning diffs for tracker IDs.

## See also

- `.claude/agents/<name>.md` — Claude harness mirror (same `.md` shape).
- `.codex/agents/<name>.toml` — Codex harness mirror (TOML shape; same content).
- `AGENTS.md` — cross-harness rule base.
