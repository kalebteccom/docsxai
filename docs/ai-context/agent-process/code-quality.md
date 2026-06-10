# Code quality standards

The bar every plan, review, and implementation must aim for. **Elegance and pragmatism over speed and convenience.** Worth a small delay in implementation time to leave the codebase better than it was found.

## Global quality gate

Every repository change — feature, fix, refactor, hotfix — must leave the global gate clean. Clean means all of the following exit 0:

```
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
```

CI runs the same gate (see [`.github/workflows/`](../../../.github/workflows/)). Pushing a diff that the local gate would reject is a self-inflicted CI failure.

The keystone test (`packages/engine/test/keystone.test.ts`) runs as part of `pnpm test` and requires Chromium — it's the regression gate for runtime behavior. Don't shortcut it.

If a residual issue remains (e.g. an external dependency emits a warning you can't suppress), document the owner and reason in the PR — don't leave unexplained global debt.

## Commit subject contract

- Conventional Commit subjects: `type(scope): subject` or `type: subject`.
- Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- Single-line, **≤72 characters**, no body, no AI-attribution trailers.
- Hooks enforce this on visible `git commit -m` / `--message=` invocations.
- Use `--no-edit` only when amending or rebasing a commit whose existing subject already satisfies the contract.

Rationale: terse, scannable git log; AI trailer noise dilutes attribution; ticket / round / plan references rot — state the why in the PR description or in `docs/ai-context/`, not the commit body.

## Improve existing code

When a change touches existing code, look for cleaner abstractions, dead code removal, better naming, fixing inconsistencies. Small, scoped refactors directly adjacent to the work belong in the **same** PR. Large refactors deserve a dedicated PR.

A plan that only adds new code on top of a messy foundation is a bad plan.

## Call out bad patterns

When you encounter anti-patterns, tech debt, or suboptimal approaches in existing code while reviewing, **explicitly call them out** in your feedback and reference the relevant area's `docs/ai-context/` discipline.

**Always suggest an alternative** — don't just flag the problem. Describe the better approach and why it's better.

## Prefer elegant solutions

Choose the simplest correct solution. Avoid over-engineering **and** avoid lazy shortcuts that create tech debt. When multiple valid approaches exist, present the alternatives with trade-offs and recommend one. If implementing a feature the right way takes slightly longer but produces meaningfully better code, **always prefer the right way** and note the trade-off.

## Verify, don't assume

Read the actual file before naming APIs, imports, config keys, generated fields, schemas, or deployment behavior. Plan snippets, memory, and old review notes can be stale. Hallucinated APIs / paths / signatures are a recurring failure mode — verifying takes seconds; debugging a hallucinated reference takes hours.

## Comments discipline

Default to writing no comments. Only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader.

- Don't explain WHAT the code does — well-named identifiers do that.
- Don't reference the current task / fix / callers ("used by X", "added for the Y flow", "handles the case from PR #123") — that belongs in the PR description.
- **No internal tracking identifiers in code or comments.** Ticket / plan / round / PR refs (`W-X#`, `Round-N`, `ask #N`, `TICKET-N`, `JIRA-N`, `#1234`, `ROLLBACK-SAFETY-PLAN`, `Security-RECOMMENDED-1`, etc.) are project-management artifacts, not code context — they rot, mean nothing to a future reader, and belong in the commit/PR body. State the actual reason instead: write _why_ the code is the way it is, not _which ticket asked for it_. Example: `// Kept as a zombie for safe rollback; remove in a follow-up cleanup` — not `// Kept per ROLLBACK-SAFETY-PLAN Rule 1`.
- **Exception — load-bearing identifier schemes** like `INV-N` invariant tags whose literal text the test discovers. docsxai has none today; the rule shape is documented for future-proofing.

A PR-time `tracker-id-auditor` agent (see [`../../../.agents/skills/tracker-id-auditor.md`](../../../.agents/skills/tracker-id-auditor.md)) regex-scans diffs as a backup.

## No half-finished implementations

- Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Validate at system boundaries (user input, the CLI argv edge, the flow-file parser, HTTP edges, Playwright/CDP edge).
- Don't add features, refactor, or introduce abstractions beyond what the task requires. Three similar lines is better than a premature abstraction.
- Don't use feature flags or backwards-compatibility shims when you can change the code. Avoid `// removed`, `// kept for compat`, `_var` re-exports.

## SOLID, applied to modern TypeScript

docsxai's architecture leans on SOLID with TypeScript-idiomatic interpretations. Concrete examples from the codebase:

### Single responsibility — one command, one file

- Per-CLI-subcommand files in the engine: `src/calibrate.ts`, `src/diagnose.ts`, `src/flow-lint.ts`, `src/flow-tree.ts`, `src/style.ts`, `src/zip.ts`, etc. One subcommand = one module. The dispatch table in `src/cli.ts` is registration only — no business logic.
- `BrowserDriver` and the Playwright integration are separated: `src/playwright-driver.ts` is the only Playwright import site. The runtime depends on the interface.
- Workspace IO is centralised in `src/workspace.ts` (`resolveWorkspacePath`). Handler modules don't touch `cwd` or absolute paths directly.

### Open–closed — extend without modifying

- New CLI subcommands attach via the dispatch table in `src/cli.ts`; the existing subcommand modules are unchanged.
- New auth strategies attach by implementing the strategy interface in `src/auth.ts`; existing strategies are unchanged.
- New flow-lint rules (R001, R002, …) attach to the lint registry in `src/flow-lint.ts`; the registry shape is the open hinge.

### Liskov — substitutable contracts

- Every `BrowserDriver` implementation honors the same shape: `navigate`, `click`, `fill`, `waitFor`, plus the `actionable()` predicate documented in [`docs/actionability-contract.md`](../../actionability-contract.md). A driver that returns a different shape is an LSP violation that breaks `flow-runtime.ts` silently.
- The flow-file step vocabulary is a closed enum; every step type honors the same `{ action, target, wait_for?, success?, annotation? }` envelope. A handler that consumes one step type can be substituted for another that consumes a different step type without rewriting `flow-runtime.ts`.

### Interface segregation — narrow contracts, optional fields

- `Step` carries optional `wait_for`, `success`, `annotation`, `annotations` fields rather than one fat interface. A handler asks for what it needs.
- `AuthStrategyDescriptor` is shaped per-strategy via discriminated unions rather than a god-config with everything optional. The `manual-capture` descriptor is narrower than an `api-direct` descriptor would be.

### Dependency inversion — depend on the abstraction

- `flow-runtime.ts` depends on `BrowserDriver`, not `playwright-core`. Swapping driver implementations doesn't change runtime code.
- The plugin's commands depend on the `site-docs` CLI bin; they don't reach into engine internals. The engine's CLI surface is the substrate boundary.
- The backend client depends on `ROUTES`, not on a specific HTTP library shape.

## Engine surface discipline

Adding a CLI subcommand or a plugin command follows the contract in `AGENTS.md` and the surface map. The discipline that makes the engine trustworthy:

- **The engine never calls a model API.** No `openai`, `@anthropic-ai/*`, `@google/genai`, no provider SDK. Inference at calibration time is supplied by the host agent (Claude Code, Codex, anything MCP-speaking). Execution mode (`site-docs run`) has no agent in the loop and no inference at all.
- **All filesystem IO routes through `resolveWorkspacePath`** in `src/workspace.ts`. No `cwd`-relative paths in handlers.
- **All Playwright API touch routes through `playwright-driver.ts`** (or `playwright-instrumented-browser.ts` for the `capture-auth` head-full path). Nothing else imports `playwright-core` directly.

## Related

- [`commit-discipline.md`](commit-discipline.md)
- [`dist-rebuild-discipline.md`](dist-rebuild-discipline.md)
- [`../architecture/surface-map.md`](../architecture/surface-map.md)
- [`../testing/qa-patterns.md`](../testing/qa-patterns.md)
