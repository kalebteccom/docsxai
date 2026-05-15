# @kalebtec/site-docs-skill

Optional colocated `.claude/skills/` fallback that delegates to the installed plugin. Secondary path for teams that want to vendor / version-pin in the consumer repo rather than rely on a globally-installed plugin.

The primary invocation path is [`@kalebtec/site-docs-plugin`](../plugin/) (`claude plugin install …`). Use this package only when global install isn't an option.

## Surface

- **`skill/site-docs/SKILL.md`** — the vendorable skill manifest.
- **`vendorSkill(targetDir)`** — copies the skill bundle into `<targetDir>/.claude/skills/site-docs/`. Idempotent.

## License

[Apache-2.0](../../LICENSE).
