# QA patterns

Read this before writing or reviewing tests, fixtures, mocks, or runtime coverage.

## Testing philosophy

Follow the Testing Trophy. For docsxai, the trophy's biggest layer is **keystone**, because runtime regressions only surface against real Chromium. Unit tests support — they catch input-validation / output-shaping / dispatch-routing regressions. Integration tests cover composed pipeline behavior.

| Layer                                 | What it catches                                                                         | What it can't                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Static (TypeScript, ESLint, Prettier) | Type errors, lint violations, format drift.                                             | Behavior.                                               |
| Unit                                  | Input validation, output shaping, dispatch routing, parser / lint-rule / planner logic. | Real-browser behavior.                                  |
| Integration                           | Pipeline composition: flow-file parse → runtime → annotation emit → viewer build.       | Real-page Playwright semantics.                         |
| Keystone                              | Real-Chromium DOM + navigation + `actionable()` + the deterministic-replay guarantee.   | (Authoritative — the floor under which a change ships.) |

Core principle: "The more your tests resemble the way docsxai is used, the more confidence they can give you." The way docsxai is used is: the engine drives a real Chromium against a real (or fixture-stand-in) authed SPA. Keystone is closest to that.

## When to mock vs. use real

**Mock:**

- The wall clock (use deterministic injection where the code uses one).
- Non-deterministic ops (PRNG).
- The docsxai backend, when testing the engine's `backend-client.ts` against a fake server.
- Network endpoints external to the target page (use route-intercept fixtures or HAR-style stubs if needed).

**Use real:**

- Real Chromium for the keystone test.
- Real `flow-file.ts` parser against fixture YAML.
- Real `flow-runtime.ts` composed pipeline against a `BrowserDriver` fake _only_ when isolating runtime logic from browser semantics; otherwise use real Chromium.
- Real `resolveWorkspacePath` against a temp directory (`tmpdir` per Vitest's pattern).

Rule of thumb: if it's substrate code and it's fast, use the real thing. If it's external or slow or non-deterministic, mock it.

## Avoid testing implementation details

**Implementation details** = things adopters of docsxai won't see, use, or know about.

**Do NOT test:**

- That `flow-runtime.ts` internally calls `playwright-driver.ts` in a specific order.
- That the CLI dispatch table uses a particular data structure.
- That `flow-lint.ts` walks rules in a particular sequence.

**Do test:**

- That a flow-file with R001-violating shape produces a specific lint diagnostic.
- That `docsxai run` against a known flow produces a stable `annotations.json` shape.
- That a halted run produces a halt artifact with the documented fields.
- That the viewer's `placeCallout` returns specific coordinates for a known input.

Litmus test: "If I refactored the internals without changing the CLI / flow-file / doc-pack / viewer contract, would this assertion break?" If yes, it's testing implementation details.

## Capturing-mock pattern (required)

When you must verify a side effect that has no observable return value (an event captured, a backend request fired), capture the value in the mock implementation, then assert on the captured value — not on `mock.calls`:

```ts
// Bad
expect(mockBackendPut).toHaveBeenCalledWith({ url: "...", body: "..." });

// Preferred — capture in mock, assert on captured value
let captured: BackendRequest[] = [];
const handler = vi.fn((req) => {
  captured.push(req);
});
// ... drive the pipeline ...
expect(captured.length).toBe(1);
expect(captured[0]).toMatchObject({ path: expectedPath, method: "PUT" });

// Better — assert observable end state directly
expect(workspaceContents).toContain("annotations.json");
```

Treat any new test that asserts on `.mock.calls` as guilty until proven innocent.

## Inverted-assertion trap

For negative cases ("should NOT halt on R002-clean flow", "should NOT include cookie value in halt context"), verify the assertion direction matches the spec's intent. An accidentally-positive assertion silently masks the regression the test exists to catch.

```ts
// If the spec says "no auth cookie in halt context":
expect(haltContext.cookies).toBeUndefined(); // correct direction
expect(haltContext.cookies).toBeDefined(); // wrong direction — masks the bug
```

## Don't import production constants into assertions

Importing production constants into test assertions hides what's being tested and silently passes when the constant changes:

```ts
// Bad
import { HALT_REASON_DRIFT } from "../diagnose";
expect(result.reason).toBe(HALT_REASON_DRIFT);

// Good — clear expectation, breaks if the wire-visible value changes
expect(result.reason).toBe("drift");
```

**Exception:** import constants for **inputs** (test data, fixture keys), not assertions.

## Fixture readability

- Durable constants and reusable fixture builders near the top of the test file.
- One-off scenario values inline.
- Named after the domain contract (`EXPECTED_HALT_CONTEXT_SHAPE`, `DEFAULT_ANNOTATIONS_FIXTURE`) — not incidental setup (`fixture1`, `mockData`).
- Avoid giant inline objects in assertions; assign them to named expected constants when the shape is part of the contract.

```ts
const EXPECTED_DRIFT_HALT = { ok: false, reason: "drift", step: "step-3" };

it("halts on locator drift", () => {
  expect(result).toMatchObject(EXPECTED_DRIFT_HALT);
});
```

## AHA testing — avoid hasty abstractions

Balance between no abstraction (duplication) and over-abstraction (conditional logic in helpers).

- **3+ tests with identical setup** justifies a builder.
- Builders are **transparent** factory functions with an `overrides` parameter — no conditional logic.
- Inline setup for one-off cases.

```ts
// Good — transparent builder
export function buildWorkspaceForKeystone(overrides: Partial<WorkspaceOptions> = {}) {
  return createWorkspace({
    root: mkdtempSync(join(tmpdir(), "docsxai-test-")),
    flows: DEFAULT_FLOWS,
    ...overrides,
  });
}

const ws = buildWorkspaceForKeystone({ flows: [DRIFT_FIXTURE_FLOW] });
```

Avoid: factories with `if/else` on a `kind` parameter; >2 levels of `describe` nesting; shared `beforeEach` state that obscures what each test needs.

## docsxai-specific rule — runtime changes require a keystone pass

**Any change to `flow-runtime.ts`, `playwright-driver.ts`, or the `actionable()` predicate MUST be covered by `packages/engine/test/keystone.test.ts`.**

Unit tests against a mocked `BrowserDriver` silently pass when the real Playwright integration is broken. The keystone test is the regression gate.

This is not negotiable. A PR touching the runtime without a keystone-passing CI run is incomplete, regardless of unit-test coverage.

## Acceptance criteria

Good acceptance criteria for a docsxai feature:

- Specific and independently verifiable.
- Affirmative ("returns a doc pack with `annotations.json` matching the flow's annotation set when the run succeeds") not "doesn't crash."
- One requirement per bullet.
- Observable: doc-pack contents, halt-context shape, lint diagnostic shape, viewer output bytes, CLI exit code + stderr.
- Edge cases: empty workspace, malformed flow-file, missing locator, drifted target page, expired auth cookie, non-zero exit on diagnostic failure.

## Heap / runtime-presence anti-pattern

Asserting heap counts of an interface-typed value is meaningless — interfaces compile to no runtime artifact. If the assertion needs a runtime presence, verify the asserted type has it (class, constructor, Map/Set) before approving.

## Test verification protocol

When writing or reviewing tests, verify the test is actually working. **All verification by hand** — do not install or run external testing tools.

**False positive check** (manual, inline):

- Temporarily change an expected value to a wrong value; the test must fail.
- If it still passes, the assertion isn't reaching the code under test (a mock is short-circuiting the real logic).
- Revert after confirming. Do this for 2–3 key assertions per file.

**Static checks:**

- `pnpm lint` clean on modified test files.
- `pnpm typecheck` clean.
- No `as any` or `@ts-ignore` in test code — fix the root cause.

## Related

- [`../agent-process/code-quality.md`](../agent-process/code-quality.md)
- [`../architecture/surface-map.md`](../architecture/surface-map.md) — the load-bearing boundaries.
