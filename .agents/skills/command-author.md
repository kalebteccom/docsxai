---
name: command-author
description: Adds a new `docsxai` CLI subcommand or a Claude Code plugin command end-to-end — dispatch table, handler module, schema, README + runbook update, unit + keystone coverage.
model: claude-opus-4-7
tools: [Read, Edit, Write, Bash, Grep, Glob]
---

# command-author

Adds a new command to docsxai's invocation surface — either an engine CLI subcommand (`docsxai <new>`) or a plugin command (`/docsxai:<new>` in the Claude Code plugin). The two paths share most of the discipline; the plugin path is a thin wrapper over the engine CLI.

## Workflow — engine CLI subcommand

1. **Handler module.** New file under `packages/engine/src/<name>.ts`. Pure logic; no `cwd`-relative paths; all filesystem touch through `resolveWorkspacePath`. No model API calls.
2. **Argument schema.** Zod schema for flags + positional args at the top of the handler module. The dispatch table in `src/cli.ts` validates against the schema before calling the handler.
3. **Dispatch table entry.** Add the subcommand to `src/cli.ts`. Registration only — no business logic in the dispatch table itself.
4. **Unit test.** `packages/engine/test/<name>.test.ts` — hermetic, no real browser, no real backend. Mock the `BrowserDriver` if the command needs one; mock `backend-client` if it needs the backend.
5. **Keystone coverage.** If the command touches the runtime, the `BrowserDriver`, or the `actionable()` predicate, the change MUST appear in `packages/engine/test/keystone.test.ts` against real Chromium. Pure-analysis commands (`lint`, `flow-tree`, `style --check`) don't require a keystone pass.
6. **README + runbook.** Add a row to `README.md` "CLI reference" and a usage example in [`docs/agent-runbook.md`](../../docs/agent-runbook.md) if the command is part of the calibration loop.
7. **Package README.** Add the subcommand to `packages/engine/README.md` "CLI commands".
8. **CHANGELOG entry.** `## Unreleased ### Added`.

## Workflow — plugin command

1. **Command file.** `packages/plugin/commands/<name>.md` with the plugin command frontmatter + body. Body is a deterministic invocation of the engine CLI; no inference, no model API.
2. **Plugin README.** Add a row to `packages/plugin/README.md` "Commands".
3. **Unit test.** The plugin's `src/index.ts` static-validation pass exercises the command tree; ensure the new command parses cleanly. Add a focused test if the command introduces a new schema variant.
4. **Documentation contract.** Plugin commands are thin wrappers — if the underlying CLI subcommand is missing or stale, build / update the CLI first per the engine path above.
5. **CHANGELOG entry.** `## Unreleased ### Added`.

## Success criteria

- All quality-gate commands exit 0 (`pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build`).
- The new command is dispatched correctly and rejects invalid arguments with a clear error.
- Workspace touch goes through `resolveWorkspacePath`; nothing imports `playwright-core` outside `playwright-driver.ts` / `playwright-instrumented-browser.ts`.
- Docs-impact pass complete: README + package README + runbook (if loop-relevant) + CHANGELOG.

## What NOT to do

- Do NOT introduce a CLI subcommand that calls a model API. The engine is inference-free.
- Do NOT bypass `resolveWorkspacePath` for any filesystem touch.
- Do NOT import `playwright-core` outside the driver files.
- Do NOT add a plugin command that re-implements engine logic — the plugin invokes the CLI, the engine does the work.
- Do NOT add tracker IDs (`W-X#`, `TICKET-N`, etc.) to source, comments, or commit body.

## Reference

- [`../../docs/ai-context/architecture/surface-map.md`](../../docs/ai-context/architecture/surface-map.md) — load-bearing boundaries.
- [`../../docs/ai-context/testing/qa-patterns.md`](../../docs/ai-context/testing/qa-patterns.md) — the keystone-vs-unit rule.
- [`../../docs/ai-context/agent-process/code-quality.md`](../../docs/ai-context/agent-process/code-quality.md)
- [`../../packages/engine/README.md`](../../packages/engine/README.md), [`../../packages/plugin/README.md`](../../packages/plugin/README.md)
