# Module and file size discipline

A file over its budget is almost always doing two jobs. The size cap is a proxy
for the real rule - **one reason to change per module**
([`architecture-principles.md`](architecture-principles.md) §5) - and a
mechanically-enforced backstop for it. This is the Kalebtec family standard
(browxai enforces the same shape on its TypeScript tree via the ESLint
`max-lines` budget); docsxai adopts it here.

## The budget

Enforced in `eslint.config.js`, run via `pnpm lint`, sized with
`skipBlankLines` + `skipComments` so the number is _code_ lines, not whitespace.

| Scope                                                 | Cap (code lines)           | Notes                                                                                                                                     |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| every production `packages/**/src/**/*.ts`            | **the whole-tree ceiling** | calibrated to the largest legitimately-cohesive file (the dispatch tables / registration modules), then ratcheted down as god-files split |
| a composition root (`cli.ts` dispatch, a `server.ts`) | **tighter**                | wiring-only; any business-logic creep trips it                                                                                            |
| dispatch / registration tables                        | **exempt or generous**     | a flat subcommand/tool/plugin registration list has one reason to change already                                                          |
| `*.test.ts`                                           | higher / out of scope      | colocated tests carry table-driven bulk legitimately                                                                                      |

The companion per-function budgets (`max-lines-per-function`, `complexity`,
`max-params`) enforce the same one-job rule at the function grain. A function that
needs blank-line section dividers is two functions.

> Status: docsxai historically shipped without a `max-lines` rule, which is how
> `engine/cli.ts` reached ~1700 lines. The enforcement pass adds the budget
> across the whole tree at a calibrated ceiling, allowlists the current god-files
> with a visible split reason, and ratchets the ceiling down wave by wave as they
> split - never relaxing it to land a feature. See
> [`fitness-functions.md`](fitness-functions.md).

## Coverage is half the rule

A budget only bites the files it is globbed onto. The enforcement pass globs
every production source file under each package's `src`, so the gate sees the
whole monorepo and no oversized file can land in any package. New code lands
inside the covered glob; a file added over the ceiling fails `pnpm lint`, not
review.

## How to split - along the second responsibility

The fix for an over-budget file is never "delete blank lines." Find the **second
reason to change** and move it to its own file:

- **Dispatch split.** A CLI entry (`cli.ts`) that fuses argument parsing, the
  dispatch table, and per-subcommand business logic is many reasons to change -
  lift each subcommand body to its own file and leave `cli.ts` a thin dispatch
  table that registers them.
- **Layer split.** A file where the engine-blind domain (doc-pack shaping, diff
  math) cohabits with an adapter (Playwright calls, HTTP) is two layers - split
  the domain out and leave a barrel so importers are unchanged.
- **Port / implementations split.** A port file that also carries its concrete
  implementations - lift the implementations to siblings, keep the contract.
- **Strategy / registry split.** A registry that also defines every strategy
  inline - one file per strategy behind the registry.

Preserve the public surface: re-export from the original path (a barrel) so the
split is invisible to callers and the dependency graph is unchanged. A split must
never introduce a `playwright-core` import outside the driver, a model-SDK
import, or an IO path that bypasses `resolveWorkspacePath`.

## The honest counter-rule

Smaller is not always better. The doctrine also says three similar lines beat a
premature abstraction, and shredding one cohesive idea across a dozen tiny files
is its own readability tax. The cap fights god-files; it does not mandate maximal
fragmentation. A dispatch table or a flow-schema definition that legitimately
runs long as one coherent thing stays whole. The target is _one reason to
change_, with the line cap as the backstop that catches the failure - not the
goal itself. The whole-tree ceiling is set just above the largest genuinely
cohesive file, never lower.

## Related

- [`architecture-principles.md`](architecture-principles.md) §5 - readability and
  the one-reason-to-change rule the cap proxies.
- [`fitness-functions.md`](fitness-functions.md) - the `max-lines` budget in the
  enforced-checks index and the frozen-doctrine meta-rule.
- [`hexagonal-and-ddd.md`](hexagonal-and-ddd.md) - the layer boundaries a clean
  split respects.
