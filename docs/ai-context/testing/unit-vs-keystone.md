# Unit vs. keystone — the layer decision rule

Read this when deciding _where_ a new test belongs. The full philosophy and
mock-vs-real guidance live in [`qa-patterns.md`](qa-patterns.md); this page is
the one-screen decision rule.

## The rule

| The code under test is…                                                                          | Layer       | Driver                                |
| ------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------- |
| Pure logic: parsing, validation, output shaping, lint rules, placement math, pixel ops, dispatch | Unit        | None / `FakeDriver`                   |
| A composed pipeline: parse → runtime → artifact emit, push → pull round-trip, plugin resolve     | Integration | `FakeDriver` / in-process fake server |
| Anything that touches a real page: locators, waits, `actionable()`, screenshots, auth capture    | Keystone    | Real Chromium — **no exceptions**     |

The trap this rule exists to prevent: a mocked-driver test that passes while
the real-browser behavior is broken. A `FakeDriver` test asserting "the runtime
called `click`" proves dispatch, not behavior. If the bug class you're guarding
against can only occur in a browser (timing, visibility, devicePixelRatio,
cross-origin, animation, clock), the test MUST be Chromium-gated — a passing
mocked test for that class is worse than no test, because it reads as coverage.

## Mechanics

- Chromium-gated suites use the established pattern:
  `describe.skipIf(!chromiumAvailable)` with the shared availability probe.
  CI installs Chromium via the documented
  `pnpm -C packages/engine exec playwright-core install chromium` step.
- Keystone fixtures are self-contained: the toy site under
  `packages/engine/test/fixtures/toy-site/` served over loopback `node:http`.
  New keystone scenarios extend the toy site rather than reaching for live
  targets.
- Determinism claims are keystone claims. "Byte-identical re-runs" is asserted
  against real Chromium twice in one test — never inferred from unit-level
  purity.
- Plugin-runtime additions get an extra integration row: a fixture plugin
  package resolved through the REAL `resolvePlugins` path (no mocking the
  loader), plus a unit row per manifest/validation branch.

## When unsure

Default up one layer. The cost of an extra keystone test is seconds of CI; the
cost of a silently-passing mocked test is a shipped regression with green
checks.
