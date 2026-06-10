---
name: plugin-feature-author
description: Adds a feature to `@kalebtec/docsxai-plugin` (Claude Code plugin) or `@kalebtec/docsxai-skill` (vendorable skill bundle) — skill, command, or manifest change.
model: claude-opus-4-7
tools: [Read, Edit, Write, Bash, Grep, Glob]
---

# plugin-feature-author

Adds a feature to the Claude Code plugin or the vendorable skill bundle. The two paths share discipline; the skill bundle is a fallback for teams that prefer vendoring over `claude plugin install`.

## Workflow — plugin skill

1. **Skill directory.** `packages/plugin/skills/<name>/SKILL.md` (kebab-case). The skill manifest carries the role definition, trigger conditions, and the structured question flow.
2. **Trigger contract.** A skill triggers when the host agent's session matches its declared conditions. Keep triggers narrow — over-broad triggers spam the operator with skill activations they didn't ask for.
3. **Question flow.** Skills emit structured questions via the host's `AskUserQuestion` (or equivalent) tool. Batch questions; carry the trade-off and the MVP implication in each option's description.
4. **Deterministic handoff.** Once the skill has the answers, it composes a deterministic engine invocation — `site-docs <subcommand>` with the resolved arguments — and hands off. The engine does the work; the skill orchestrates.
5. **Unit test.** Exercise the skill's static structure via `packages/plugin/src/index.ts`'s validation helpers. Skill behavior end-to-end is exercised at the calibration-loop level (slow, manual today; harness-integration in Phase 2).
6. **Plugin README.** Add a row to `packages/plugin/README.md` "Skills".
7. **CHANGELOG entry.** `## Unreleased ### Added`.

## Workflow — plugin command

See [`command-author.md`](command-author.md) "Workflow — plugin command".

## Workflow — vendorable skill bundle

1. **Bundle update.** `packages/skill/skill/site-docs/SKILL.md` — the manifest the bundle ships. The bundle is a thin re-export of plugin-side skills, so most changes land in the plugin first and the bundle tracks.
2. **`vendorSkill` parity.** Ensure `packages/skill/src/index.ts`'s `vendorSkill(targetDir)` copies the updated bundle correctly. Idempotent.
3. **Skill README.** Update `packages/skill/README.md` if the bundle's surface changed.
4. **CHANGELOG entry.** `## Unreleased ### Added` (or `### Changed` if the bundle's shape moved).

## Success criteria

- `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build` clean.
- Plugin manifest parses; static validation in `packages/plugin/src/index.ts` reports no issues.
- The skill / command is discoverable by the Claude Code plugin host (matches the expected manifest layout).
- Docs-impact pass complete: plugin README + skill README (if vendored) + CHANGELOG.

## What NOT to do

- Do NOT make the plugin call a model API directly. The plugin orchestrates the host's inference and invokes the deterministic engine; it doesn't import a provider SDK.
- Do NOT duplicate engine logic in a plugin skill. If the skill needs new engine capability, add it to the engine first per [`command-author.md`](command-author.md).
- Do NOT reach into engine internals from plugin code. The CLI is the substrate boundary.
- Do NOT add tracker IDs in source, comments, or commit body.

## Reference

- [`../../packages/plugin/README.md`](../../packages/plugin/README.md), [`../../packages/skill/README.md`](../../packages/skill/README.md)
- [`../../docs/ai-context/architecture/surface-map.md`](../../docs/ai-context/architecture/surface-map.md)
- [`../../docs/ai-context/agent-process/code-quality.md`](../../docs/ai-context/agent-process/code-quality.md)
- [`command-author.md`](command-author.md)
