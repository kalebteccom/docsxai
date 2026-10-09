# @docsxai/skill

Optional colocated `.claude/skills/` fallback that delegates to the installed plugin. Secondary path for teams that want to vendor / version-pin in the consumer repo rather than rely on a globally-installed plugin.

The primary invocation path is [`@docsxai/plugin`](../plugin/) (`claude plugin install …`). Use this package only when global install isn't an option.

The skill tells the agent to use the plugin's `/docsxai:*` commands when they exist. Without the plugin it lists the `docsxai` CLI commands for re-running, checking and delivering a workspace (`doctor`, `run`, `render`, `burn`, `pack`, `diagnose`), and points at the plugin's `calibrate` playbook for authoring flows. After upgrading `docsxai`, run `vendorSkill()` again so the copy matches the CLI.

## Surface

- **`skill/docsxai/SKILL.md`** — the vendorable skill manifest.
- **`vendorSkill(targetDir)`** — copies the skill bundle into `<targetDir>/.claude/skills/docsxai/`. Idempotent.

## License

[Apache-2.0](../../LICENSE).
