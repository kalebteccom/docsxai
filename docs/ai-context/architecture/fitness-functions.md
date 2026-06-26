# Fitness functions

Every architectural characteristic docsxai cares about has an automated check that
**fails when the characteristic regresses**. This index is the answer to "what
breaks if my change is not as boundary-respecting as I think it is."

The meta-rule: **a fitness function is frozen doctrine. You do not edit it to make
your change pass; you change your code.** The only legitimate edits are a new
function for a new invariant, or a budget tightened as the tree shrinks. A
characteristic with no green check is an aspiration, not a guarantee - this index
holds that distinction.

## What is enforced

| Check                     | What it proves                                                                                                                      | Where                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript project graph  | Package layering: a package cannot import another it does not declare; `@docsxai/engine` does not depend on `@docsxai/backend` etc. | `tsc` project references, via `pnpm typecheck`                                                                                      |
| docsxai custom lint rules | The repo-specific invariants wired as `error`                                                                                       | `eslint.config.js`, via `pnpm lint`                                                                                                 |
| Keystone determinism      | `docsxai run` reproduces a doc pack byte-identically from the same flow-file + target state, against a real browser                 | `packages/engine/test/keystone.test.ts`, via `pnpm test` (Chromium)                                                                 |
| Unit + integration suites | Domain and use-case behavior                                                                                                        | `vitest`, via `pnpm test`                                                                                                           |
| `max-lines` budget        | No production file exceeds its cap; god-files never re-form                                                                         | ESLint `max-lines` globbed across `packages/*/src`, ratcheted as files split ([`module-and-file-size.md`](module-and-file-size.md)) |
| Import bans               | No `playwright-core` outside `playwright-driver.ts` / `playwright-instrumented-browser.ts`; no model-provider SDK in any package    | ESLint `no-restricted-imports`, via `pnpm lint`                                                                                     |
| `no-circular`             | No runtime import cycles (type-only cycles excluded - they are erased at compile)                                                   | dependency-cruiser, via `pnpm depcruise`                                                                                            |
| Duplication budget        | Copy-paste stays under the 3% budget                                                                                                | jscpd, via `pnpm jscpd:check`                                                                                                       |

The no-model-API contract and the `BrowserDriver` boundary are the two
load-bearing invariants the import bans make mechanical. A `playwright-core`
import outside the driver, or any `openai` / `@anthropic-ai/*` / `@google/genai`
import in any package, fails `pnpm lint`.

## How to use this index

- **Adding a browser-touching surface?** It goes through `BrowserDriver`; a direct
  `playwright-core` import fails the layering rule and names it.
- **Adding a file?** Keep it under the `max-lines` ceiling, or it fails `pnpm lint`.
- **Touching the runtime / auth / page interaction?** Run the keystone test - it
  is the determinism regression gate.
- **Moving a boundary?** Run `pnpm depcruise`; a new cross-layer import fails the
  graph.

## The meta-rule

A fitness function is frozen doctrine. An inline disable of an architecture check,
or a relaxed budget in a feature PR, is the one thing this file forbids outright.
Tighten a budget as modules shrink; never loosen one to land a change.

## Related

- [`architecture-principles.md`](architecture-principles.md) - the laws these
  functions enforce.
- [`module-and-file-size.md`](module-and-file-size.md) - the size budget in depth.
- [`hexagonal-and-ddd.md`](hexagonal-and-ddd.md) - the layer map the layering
  rules hold in place.
- [`../testing/tdd-and-test-strategy.md`](../testing/tdd-and-test-strategy.md) -
  the test layers, including the keystone gate.
