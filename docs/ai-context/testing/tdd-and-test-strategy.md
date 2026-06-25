# TDD and test strategy

How we test docsxai. The hexagonal layout exists partly to make this cheap: the
pure domain (flow-file parsing, doc-pack shaping, diff math, redaction) tests in
microseconds with no browser and no IO, so test-first is the path of least
resistance, not a chore. This is the test-first companion to
[`unit-vs-keystone.md`](unit-vs-keystone.md) (the unit/keystone layering) and
[`qa-patterns.md`](qa-patterns.md) (the playbook).

## TDD is the default

Write the test first, watch it fail, make it pass, refactor. This is the standing
expectation for the layers where a test is fast and the behavior is the point:
the flow-file parser and its Zod schema, the doc-pack model and revision rules,
`diff.ts`, `redact.ts`, the exporters, and every use case that composes them.

- A new flow-schema invariant -> a failing parser unit test, then the schema rule.
- A new doc-pack rule (linear-immutable, content-addressing) -> a failing
  doc-pack test, then the method that satisfies it.
- Refactors are safe precisely because the behavior is pinned first - which is
  exactly why this matters for the hexagonal split: a god-file is split under a
  green test, never by hope.

Pragmatic exception: thin adapters and wiring (a Playwright call, an HTTP route
shape, a dispatch-table entry) are sometimes clearer written-then-tested. The
rule is test-first where the logic lives, not dogma everywhere.

## The layers

The more a test resembles how the system is actually used, the more confidence it
gives - so favor the outer, more-realistic layers when the cost is acceptable.

- **Domain unit** (`vitest`, colocated) - flow-file parsing, doc-pack invariants,
  diff severity, redaction. Pure, no browser, no IO. The fastest and most numerous.
- **Use-case** (`vitest`) - `calibrate` / `run` / `render` / `diagnose` / `lint`
  orchestration against a fake `BrowserDriver` and an in-memory workspace. No real
  browser.
- **Adapter** (`vitest`) - each adapter honors its port: `PlaywrightDriver`
  satisfies `BrowserDriver`, an auth strategy round-trips, a publisher plugin
  produces the expected payload.
- **Keystone** (`packages/engine/test/keystone.test.ts`, real Chromium) - the
  determinism floor: `docsxai run` reproduces a doc pack byte-identically from the
  same flow-file + target state. This is the regression gate for anything touching
  the runtime, page interaction, or auth. See [`unit-vs-keystone.md`](unit-vs-keystone.md).

## Mock vs real

Mock what is slow, external, or non-deterministic: the browser (the
`BrowserDriver` port - use a fake in use-case tests), wall-clock time, network
egress, the backend HTTP edge. Use the real thing for anything that is substrate
and fast: the real flow-file parser, the real doc-pack model, the real exporters,
the real use cases. If it is our code and it is fast, do not mock it - and never
mock to make a god-file's untestable internals "pass"; split it instead so the
real logic is reachable.

## Test hygiene (carried from the family)

- **Do not test implementation details.** Litmus: if I refactored the internals
  without changing observable behavior, would this assertion break? If yes, it is
  testing internals. Assert on the emitted doc pack / parsed flow / returned
  result, not on how a helper was called.
- **Assert observable end state**, not mock call-counts.
- **Verify the test can fail.** For the key assertions in a file, flip the
  expected value once and confirm red, then flip back. A test that cannot fail is
  worse than no test.
- **Assert the specific error / halt-cause variant**, not just that something threw.
- **Determinism is testable, not hopeful.** The keystone byte-identical assertion
  is the contract; content-addressing and diffing depend on it.

## Running it

`pnpm test` runs the vitest suites; the keystone test requires Chromium
(`pnpm -C packages/engine exec playwright-core install chromium` once). The full
gate before pushing: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
&& pnpm build` - all exit 0.

## Related

- [`unit-vs-keystone.md`](unit-vs-keystone.md) - the unit/keystone layering and
  why boundary behavior is keystone-tested against a real browser.
- [`qa-patterns.md`](qa-patterns.md) - the QA-patterns playbook.
- [`../architecture/fitness-functions.md`](../architecture/fitness-functions.md) -
  the keystone determinism check in the enforced-checks index.
