# Agent-process discipline

Cross-cutting working rules for every diff in this repo.

- [`code-quality.md`](code-quality.md) — the quality gate, SOLID applied to docsxai's TypeScript, comments discipline, no-tracker-IDs rule.
- [`commit-discipline.md`](commit-discipline.md) — single-line conventional subjects ≤72 chars, no body, no AI trailers; cycle-per-commit cadence.
- [`dist-rebuild-discipline.md`](dist-rebuild-discipline.md) — the `dist/cli.js` trap and the plugin-daemon restart discipline; the local verify gate before push.

The repo-root [`AGENTS.md`](../../../AGENTS.md) is the rule base. These files unpack the _why_ behind the rules and give worked examples.
