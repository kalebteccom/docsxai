# Architecture principles - the Kalebtec doctrine

The macro layer of how we build. Identical across browxai, docsxai, and remotxai;
each repo leads with its own exemplars, but the principles are the same doctrine.
New Kalebtec projects adopt it on day one.

## Purpose, and how this relates to code-quality.md

[`code-quality.md`](../agent-process/code-quality.md) is the **micro** layer:
SOLID-in-TypeScript, naming, function shape, comment discipline, the
no-half-finished rule. This doc is the **macro** layer: where the boundaries
are, which direction dependencies point, which seams are real, and where the
performance budget lives. Both bind on every change. A module can pass every
micro rule and still violate the architecture (a clean, well-named function that
imports `playwright-core` straight into `flow-runtime.ts` is tidy and wrong).
Read this first when the change moves a boundary, adds a surface that acts on the
world, or sits on a hot path. Read code-quality.md when shaping the code inside a
boundary that already exists.

The bar is the same one code-quality.md sets: elegance and pragmatism over speed
and convenience, with **performance as a design input, not an afterthought.**

## 1. Dependency direction and boundaries

The load-bearing rule: **the core depends on nothing outward.** Outward concerns
(protocols, IO, vendors, model providers, transports) are adapters that sit
behind a port the core owns. Dependencies point inward, toward the domain, never
out toward the framework.

docsxai is the family's cleanest illustration:

- **`BrowserDriver` is the only browser abstraction.** `flow-runtime.ts` depends
  on the `BrowserDriver` interface, never on `playwright-core`. The single
  Playwright integration point is `playwright-driver.ts` (plus
  `playwright-instrumented-browser.ts` for the headed `capture-auth` path).
  Nothing else in the engine imports `playwright-core`. This is what lets browxai
  slot in as the model-agnostic discovery driver during calibration - a second
  real implementation of the same port.
- **`resolveWorkspacePath` in `workspace.ts` is the only filesystem root.** Every
  byte of IO routes through one chokepoint. No `cwd`-relative paths in handler
  code; the workspace argument from the CLI is the only root. One place to reason
  about where files land, one place to enforce the no-escape rule.
- **The engine never calls a model API.** No `openai`, `@anthropic-ai/*`,
  `@google/genai` - ever. Inference at calibration time is supplied by the host
  agent through MCP; execution mode (`docsxai run`) has no agent in the loop at
  all. The provider SDK is an outward concern that lives in the future SaaS
  surface, not in this repo.

The family echoes this everywhere: remotxai's `packages/adapter-contract` is the
single Zod-schema source of truth that every harness adapter (Claude Code, Codex,
Pi) and the daemon build against - the hexagonal host-core/adapters split made
concrete. browxai's server handlers depend on abstract `Page` / `BrowserContext`,
not a concrete CDP backend, and its plugin runtime exposes a `PluginApi` port that
plugins call rather than reaching into internals.

### The honest tension: abstract only at a proven seam

A port you do not need is tech debt, the same as a missing one. Speculative
generality is the more seductive failure because it looks like good architecture.
**The test:** is there a second real implementation today, or a committed
near-term need? If yes, the seam is proven - build the port. If no, write the
concrete thing and inline it.

- `BrowserDriver` is **proven**: docsxai has `PlaywrightDriver` and browxai is the
  real second driver. The interface earns its keep.
- remotxai's adapter-contract is **proven**: three adapters ship against it today.
- A single-implementation interface with no second consumer on the horizon is
  **usually not** - it adds an indirection, a file, and a lie ("this is
  swappable") for no payoff. Write the concrete module; extract the port the day
  the second implementation is real.

When in doubt, prefer the concrete code. Extracting a port from working code is a
cheap, safe refactor; deleting a speculative port that the codebase has grown
around is not.

## 2. Simplicity and YAGNI, reconciled with "perfect architecture"

"Perfect architecture" does not mean maximal architecture. It means **the
simplest design that honors the proven seams** - no fewer boundaries (the core
must stay clean), no more (every speculative port is deleted). The two pulls
resolve cleanly once you separate proven from speculative: hold the proven seams
without compromise, and refuse every unproven one.

The family's own cautionary tale is docsxai's dropped `DiscoveryStage` /
`MappingStage` / `CommitStage` pipeline (the deleted `pipeline.ts`). The original
design put the agent-orchestration loop **inside the engine** as resumable stage
objects. In practice, browxai's MCP surface plus the calibrate-skill playbook
covered the same ground with no bespoke in-engine state machine. The lesson, from
the repo's own postmortem (`docs/archive/phase-plans/PHASE-1.md`): agent
orchestration belongs in the agent's tooling layer, not duplicated in the engine.
The engine's job is the deterministic floor (parse, run, emit) plus write-time
signal (`actionable()`, `lint`, `diagnose`); the inference loop is the host
agent's. Removing that premature abstraction made the system smaller **and**
more correct.

Concrete rules that follow:

- Three similar lines beat a premature abstraction. Extract on the third real
  divergence, not the first guess.
- No feature flags or compat shims when you can just change the code. No
  `// removed`, no `// kept for compat`, no `_var` re-exports.
- Don't add error handling for states that can't occur. Validate at the system
  boundary (CLI argv, the flow-file parser, HTTP edges, the Playwright/CDP edge);
  trust internal code past it.

## 3. Performance at the core

Performance is a design input. It shapes the boundary you draw, the buffer you
bound, the data you copy. But it is **measured, not guessed** - profile before
you optimize, and never trade a proven seam for a micro-optimization you can't
demonstrate.

**Hot path vs cold path.** Spend your optimization budget where the work is
continuous; leave the rare path simple. docsxai's two-mode split is exactly this
discipline made structural: **calibration is rare** (AI-assisted, human in the
loop, latency-tolerant) and **execution is continuous** (`docsxai run` replays a
doc pack deterministically, no agent, no inference, possibly in CI on every
push). The execution loop earns careful attention to allocation and IO; the
calibration helpers do not. browxai draws the same line per tool - `read` /
`action` are bounded by anti-wedge deadlines because they run constantly; a
`diagnostics` run is off by default and tolerates cost.

**Bound the buffer; stream over slurp.** Unbounded reads are a latency and memory
bug waiting for a big input. The family bounds at the edge:

- docsxai truncates page-DOM snippets before they enter halt context, and applies
  screenshot redaction in-memory **before any byte hits disk**.
- docsxai's screenshot blobs are content-addressed by sha256 - identical content
  is stored and transported once. Determinism plus content-addressing is a
  caching strategy that pays: byte-identical re-runs do no redundant work.
- browxai caps `canvas_capture` at 16384×16384 px, floors `gesture_chain`'s
  `move` at 5 ms and clamps `wait` at 5000 ms, and prefers a bounded-window
  `watch` poll over unbounded repeated calls.

**The cost of abstraction on a hot path.** A port indirection is nearly free on a
cold path and worth it for the seam. On a tight inner loop, an interface dispatch
or an extra allocation per iteration can matter - but only measurably. The rule:
keep the seam at the boundary, and if a hot inner loop needs the concrete type,
inline within the adapter, never by collapsing the boundary the whole system
depends on. Don't micro-optimize a cold path to shave microseconds nobody waits
for; don't allocate carelessly in a loop that runs on every step.

**Determinism where it pays.** docsxai's `docsxai run` produces a byte-identical
doc pack from the same flow-file and target state - keystone-enforced against a
real browser. Determinism is what makes caching, diffing (`diffDocPacks` with
pixel-diff severity thresholds), and content-addressing correct rather than
hopeful.

## 4. Scalability seams - where the system grows

Growth should be **open/closed**: add a new file at a known extension point,
don't edit the core. The family's seams:

- **New engine / driver = new adapter behind the existing port.** A second
  `BrowserDriver`, a new CDP backend, a new harness adapter against
  remotxai's contract - none of these touch the runtime or the daemon core.
- **New capability = a new gated interface.** Anything that acts on the world
  (writes outside the workspace, leaves the machine, holds a secret) lands
  off-by-default behind a declared gate, in the same diff that adds the surface.
  See [`capability-posture-map.md`](capability-posture-map.md).
- **New tool / command = compose existing ports.** A new docsxai subcommand
  attaches to the `cli.ts` dispatch table (registration only, no business logic);
  a new auth strategy implements the strategy interface; a new lint rule attaches
  to the registry. The hinge is open; the existing modules are unchanged.
- **New delivery format = a new exporter / publisher plugin.** Pure projections
  (`export/`) compose with capability-gated egress plugins; the engine core emits
  files and payloads only.

Statelessness and bounded concurrency are the runtime side of this. The backend
is a stateless HTTP surface with content-addressed, linear-immutable revisions - horizontal by construction. Where concurrency exists, it is bounded with
backpressure (deadlines, step caps, poll windows), never unbounded fan-out.

## 5. Readability and maintainability

Code reads like the domain. A flow-file is `prerequisites` + `locators` +
`steps[]`; a subcommand is one file; a tool is one file. The structure mirrors
the problem so the next reader navigates by intuition.

- **One reason to change per module.** `cli.ts` changes when dispatch changes,
  not when a subcommand's logic changes. `workspace.ts` changes when the IO root
  policy changes. If two unrelated reasons touch one file, split it.
- **The next-reader test.** Write for the agent or engineer who opens this file
  cold in six months with no context. Names carry the meaning; comments state the
  non-obvious constraint, never narrate the code (the full comment discipline is
  in code-quality.md - follow it, don't restate it here).
- **Docs-impact is part of the change.** Every behavior-change diff updates the
  relevant runbook, `CHANGELOG.md`, `AGENTS.md` if a rule moved, and surfaces
  scope movement to the owner. A boundary change that isn't reflected in the
  surface map is half-done.

## 6. The decision record

When an architecture decision is non-obvious - a new boundary, a port extracted
or refused, a posture change, a seam moved - **write down why.** Code shows what;
the record preserves the reasoning a future reader (or a future you) needs to not
re-litigate it.

- Substantive decisions get an RFC. browxai keeps numbered RFCs under
  `docs/rfcs/`; mirror that when a docsxai decision warrants it.
- Root-cause findings and one-off diagnoses go in `investigations/` under this
  `ai-context/` tree.
- Closed-out design narratives live in the phase-plan archive
  (`docs/archive/phase-plans/`) - the `PHASE-1` postmortem is the canonical
  example of a decision (dropping the Stage pipeline) captured well enough that
  nobody re-proposes it.

Keep provenance out of the code and the public docs (no ticket IDs, no phase
tags); keep it in the commit body, the RFC, and this `ai-context/` tree.

## 7. Review checklist

Every change that touches a boundary, a surface, or a hot path is reviewed
against this:

- [ ] **Dependency direction respected?** Core depends inward; no vendor / IO /
      provider import leaked past its adapter. (For docsxai: no `playwright-core`
      outside the driver, no model SDK anywhere, all IO through
      `resolveWorkspacePath`.)
- [ ] **Is the seam proven?** A new abstraction has a second real implementation
      or a committed near-term need. No speculative ports.
- [ ] **Simplest design that honors the constraints?** No premature abstraction,
      no compat shim, no error handling for impossible states. Could three lines
      replace the new interface?
- [ ] **Hot path measured?** If it's on a continuous path, the cost is known, not
      guessed. Buffers bounded, no careless per-iteration allocation or copy.
- [ ] **Capability-gated if it acts on the world?** New world-touching surface is
      off-by-default behind a declared gate, with a denial test, in the same diff.
- [ ] **Docs updated?** Surface map / runbook / CHANGELOG / AGENTS.md reflect the
      change; the decision is recorded if it was non-obvious.

## Related

- [`code-quality.md`](../agent-process/code-quality.md) - the micro layer (SOLID,
  naming, function shape, comments).
- [`surface-map.md`](surface-map.md) - the package map and the load-bearing
  boundaries this doctrine protects.
- [`capability-posture-map.md`](capability-posture-map.md) - the on-by-default /
  gated lattice.
- [`../testing/unit-vs-keystone.md`](../testing/unit-vs-keystone.md) - why
  boundary behavior is keystone-tested against a real browser.
