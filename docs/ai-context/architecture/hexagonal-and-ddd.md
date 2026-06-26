# Hexagonal architecture and DDD - the layer map

How docsxai is shaped, and the words it is shaped in. The macro doctrine
([`architecture-principles.md`](architecture-principles.md)) says _why_ the
boundaries are where they are; this page says _where things go_ and _what to
call them_. Read it when deciding where new code belongs, or before moving a
boundary. It is the unifying frame over [`surface-map.md`](surface-map.md) (the
nine-package map) and [`capability-posture-map.md`](capability-posture-map.md)
(the gated lattice).

docsxai is ports-and-adapters. Dependencies point **inward**: the engine core
depends on nothing outward, and every outward concern (a browser, a model
provider, the filesystem, a wiki/VCS egress, an HTTP transport) sits behind a
port the core owns. The map below is where each kind of code lives.

## The layers

Five roles, dependencies pointing inward. docsxai is a pnpm workspace, not a
single package, so the strongest boundaries fall on package edges; within
`@docsxai/engine` the roles are file-level. The dependency rule is enforced by
dependency-cruiser plus the custom lint rules - see
[`fitness-functions.md`](fitness-functions.md).

| Role          | Where                                                                                                                                                                                                                                                                       | Holds                                                  | Never holds                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Domain / core | `engine/src`: the flow-file parser (`flow-file.ts`), the deterministic runtime (`flow-runtime.ts`), the doc-pack model (`doc-pack.ts`), `diff.ts`, `redact.ts`, the workspace path chokepoint (`workspace.ts`), pure exporters (`export/*`)                                 | the flow/doc-pack domain, invariants, pure projections | `playwright-core`, any model SDK, vendor IO |
| Application   | the calibration-aid helpers and orchestrating commands: `calibrate.ts`, `diagnose.ts`, `flow-lint.ts`, `flow-tree.ts`, `style.ts`, `doc-pack-io.ts`, `backend-client.ts` use-case side                                                                                      | use cases composing domain through ports               | concrete drivers, provider SDKs             |
| Ports         | the `BrowserDriver` interface, the auth-strategy interface (`auth/`), the workspace plugin-runtime ports (publisher / renderer / lint-rule / auth-strategy), the backend client contract                                                                                    | the contracts the core owns                            | implementations                             |
| Adapters      | `playwright-driver.ts` + `playwright-instrumented-browser.ts` (the **only** `playwright-core` importers), the first-party plugins (`plugin-confluence`, `plugin-starlight`), the viewer renderers (`@docsxai/viewer`), the backend store, the auth-strategy implementations | concrete port implementations                          | domain rules, cross-layer reach-in          |
| Composition   | the `docsxai` CLI dispatch (`cli.ts`, `plugins-cli.ts`), `@docsxai/backend` `server.ts`, `@docsxai/mcp` `server.ts`, `@docsxai/plugin`                                                                                                                                      | wiring; dispatch tables, no business logic             | domain rules                                |

The three non-negotiables, enforced mechanically (see
[`fitness-functions.md`](fitness-functions.md)):

- **No `playwright-core` outside the driver.** `flow-runtime.ts` and everything
  else depend on the `BrowserDriver` interface. Only `playwright-driver.ts` (and
  the headed `playwright-instrumented-browser.ts`) import Playwright - which is
  what lets browxai slot in as a second driver during calibration.
- **No model SDK anywhere in the engine.** `openai` / `@anthropic-ai/*` /
  `@google/genai` never appear. Inference at calibration time comes from the host
  agent over MCP; execution has no agent in the loop. The provider SDK lives in
  the SaaS surface, not this repo. This is the load-bearing contract.
- **All filesystem IO through `resolveWorkspacePath`.** One chokepoint, one place
  to enforce the no-escape rule. No `cwd`-relative paths in handler code.

## Ports and adapters

A **port** is a contract the core owns because it has a real, _proven_ need - a
second implementation today or a committed one (the proven-seam test,
[`architecture-principles.md`](architecture-principles.md) §1). docsxai's proven
ports:

- **`BrowserDriver`** - `PlaywrightDriver` today, browxai as the committed second
  driver. The interface earns its keep.
- **the plugin-runtime ports** - publisher / renderer / lint-rule / auth-strategy
  each have multiple implementations (first-party plugins + workspace plugins).
- **the auth-strategy interface** - one per target-site auth shape.

The **composition roots** are the binaries: the `docsxai` CLI (`cli.ts`), the
backend `server.ts`, and the MCP `server.ts`. Each is the one place that knows
both the concrete adapters and the use cases and wires them - a dispatch table,
no business logic. Business logic in a composition root is a smell the size
budget catches.

## DDD building blocks, as used here

- **Value object** - immutable, compared by value. A **locator**, a **step**, a
  content-addressed screenshot blob (sha256-keyed - identical content stored and
  transported once).
- **Aggregate** - owns its invariants and is the unit of consistency. The
  **doc-pack** is the worked example: a finalized doc-pack is linear-immutable;
  its revisions are content-addressed; `docsxai run` reproduces it byte-identically
  from the same flow-file + target state (keystone-enforced). The **flow-file**
  is the other: `prerequisites` + `locators` + `steps[]`, parsed against a Zod
  schema, never `eval`'d.
- **Domain error vs IO failure** - a violated flow invariant or a halt-cause is a
  structured domain signal; a Playwright/IO failure surfaces as a typed failure.
  Callers branch on a typed shape, not a string.
- **Use case** - one user-meaningful operation: `calibrate`, `run`, `render`,
  `diagnose`, `lint`. Each composes ports and domain; a CLI subcommand is one
  file that attaches to the dispatch table, holding no rule that belongs in the
  domain.

## Ubiquitous language

Use these terms exactly, in code and prose:

- **flow-file** - the declarative `prerequisites`/`locators`/`steps[]` document.
  **step** - one interaction (`click`/`fill`/`select`/`wait_for`/`assert`),
  `optional: true` for conditional UI. **locator** - a stable element handle.
- **doc-pack** - the emitted, content-addressed, linear-immutable documentation
  artifact. **revision** - one finalized version of a doc-pack.
- **calibration** - the rare, AI-assisted mode where a host agent authors flows.
  **execution** (`docsxai run`) - the continuous, deterministic, zero-LLM replay.
- **BrowserDriver** - the browser port; **driver** - a concrete implementation.
- **capability** - a declared gate for anything acting on the world (egress,
  secrets, writes outside the workspace). **halt-cause** - the structured reason a
  flow stopped. **actionable()** - the write-time predicate that says whether a
  step will hold before it is committed.

## Where new work goes - a decision rule

- A new flow/doc-pack invariant -> the domain (`flow-file.ts` / `doc-pack.ts`),
  with a unit test first (TDD).
- A new user-meaningful operation -> a new CLI subcommand file attached to the
  `cli.ts` dispatch table (registration only, no business logic).
- A new browser backend -> a new `BrowserDriver` adapter; **never** a
  `playwright-core` import outside the driver.
- A new delivery format -> a new exporter (`export/`, pure projection) or a
  capability-gated publisher/renderer plugin; the engine core emits files and
  payloads only.
- A new world-touching surface (egress, secret, write) -> off-by-default behind a
  declared capability, in the same diff
  ([`capability-posture-map.md`](capability-posture-map.md)).

## Related

- [`architecture-principles.md`](architecture-principles.md) - the macro doctrine.
- [`module-and-file-size.md`](module-and-file-size.md) - the one-reason-to-change
  size discipline and its budget.
- [`fitness-functions.md`](fitness-functions.md) - the executable checks that hold
  every boundary above in place.
- [`surface-map.md`](surface-map.md) - the nine-package map.
