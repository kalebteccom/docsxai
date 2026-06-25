# `docs/ai-context/` — agent-facing routing layer

This subtree is the **agent-facing** companion to the public `docs/` runbooks. It is **not** part of any published documentation site; it lives in the repo so every harness has the same context and so the discipline is version-controlled with the code it governs.

## Read this before touching the relevant area

- Moving a boundary, adding a world-touching surface, or working a hot path → read [`architecture/architecture-principles.md`](architecture/architecture-principles.md) (macro doctrine) alongside [`agent-process/code-quality.md`](agent-process/code-quality.md) (micro layer).
- Figuring out where new code goes, or what to call it → read [`architecture/hexagonal-and-ddd.md`](architecture/hexagonal-and-ddd.md) (the layer map, ubiquitous language, the where-does-it-go rule).
- Creating or splitting a file/module → read [`architecture/module-and-file-size.md`](architecture/module-and-file-size.md) (the one-reason-to-change size budget and its ratchet).
- Adding an architectural guarantee, or before relying on one → read [`architecture/fitness-functions.md`](architecture/fitness-functions.md) (what is enforced today vs built in the enforcement pass).
- Adding a CLI subcommand or plugin command → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`architecture/documentation-contracts.md`](architecture/documentation-contracts.md).
- Adding a tool to the standalone MCP server (`packages/mcp/`) → read [`tool-registration/mcp-tool-registry.md`](tool-registration/mcp-tool-registry.md).
- Writing a test → read [`testing/tdd-and-test-strategy.md`](testing/tdd-and-test-strategy.md) (test-first workflow + the layers), [`testing/qa-patterns.md`](testing/qa-patterns.md), and [`testing/unit-vs-keystone.md`](testing/unit-vs-keystone.md).
- Writing or touching a plugin (publisher / renderer / lint-rules / auth-strategy) → read [`plugin-runtime/lifecycle-and-namespacing.md`](plugin-runtime/lifecycle-and-namespacing.md).
- Adding any gated/acting surface (MCP tool, plugin kind, auth strategy, webhook, output strategy) → read [`architecture/capability-posture-map.md`](architecture/capability-posture-map.md) and [`secrets-and-egress/auth-catalogue-and-masking.md`](secrets-and-egress/auth-catalogue-and-masking.md).
- Touching the engine runtime, the `BrowserDriver` interface, or auth strategies → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`testing/qa-patterns.md`](testing/qa-patterns.md) — the keystone test is the regression gate.
- Touching any code path that writes artifacts (screenshots, annotations, halt context, doc-pack zip) → read [`secrets-and-egress/README.md`](secrets-and-egress/README.md).
- Releasing or changing the surface → read [`release-process/semver-clock.md`](release-process/semver-clock.md).
- Editing a commit message or pushing without local verify → read [`agent-process/commit-discipline.md`](agent-process/commit-discipline.md) and [`agent-process/dist-rebuild-discipline.md`](agent-process/dist-rebuild-discipline.md).

## Information architecture

| Subdir                | Purpose                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-process/`      | Cross-cutting discipline: commits, dist-rebuild, code quality (the f3-inspired big one).                                                                                                                                                                                |
| `architecture/`       | Substrate references: the Kalebtec architecture-principles doctrine, the hexagonal/DDD layer map + ubiquitous language, the module/file-size discipline, the fitness-function index, surface map across the nine packages, capability posture, documentation contracts. |
| `secrets-and-egress/` | Trust posture for everything that writes to disk or surfaces text. No in-engine JS-injection surface; the trust surface is auth artifacts, screenshots, and halt context.                                                                                               |
| `plugin-runtime/`     | Plugin lifecycle, namespacing, capability + lock discipline for the workspace plugin runtime (publishers / renderers / lint-rules / auth-strategies).                                                                                                                   |
| `tool-registration/`  | The MCP tool registry discipline for `packages/mcp/`: one tool = one file, registry composed only in `server.ts`, the add-a-tool checklist.                                                                                                                             |
| `testing/`            | Unit / keystone layering and the QA-patterns playbook.                                                                                                                                                                                                                  |
| `release-process/`    | Semver clock, branch-protection reference, the public-flip checklist.                                                                                                                                                                                                   |
| `investigations/`     | Root-cause write-ups for non-obvious bugs. Empty today; one-off entries land as `<YYYY-MM-DD>-<slug>.md`.                                                                                                                                                               |
| `adopter-reports/`    | Field reports from teams driving docsxai against real workloads. Empty today; reports land as dated entries.                                                                                                                                                            |

## How this differs from the public `docs/` runbooks

|                | `docs/` (public)                                                        | `docs/ai-context/` (agent-facing)                        |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Audience       | adopters integrating docsxai                                            | agents and contributors working _on_ docsxai             |
| Promise        | public API contract (CLI surface, flow-file schema, ActionResult shape) | working discipline + design rationale + captured lessons |
| Published      | yes (when a docs site lands; today the runbooks are repo-only markdown) | no, repo-only                                            |
| Versioned with | semver-frozen surface                                                   | code                                                     |
| Read when      | integrating, debugging adopter-side                                     | making changes here                                      |

## Source-of-truth pointers

- `AGENTS.md` (repo root) — operating rules + repo map + trust posture. The agent-agnostic entry point. Every harness loads it.
- `docs/archive/phase-plans/PHASE-0.md`, `docs/archive/phase-plans/PHASE-1.md` — archived phase-closure narratives; the best "why is the engine shaped like this" sources (especially the `PHASE-1.md` agent-integration-contract postmortem).

Repo-local docs (`AGENTS.md`, `docs/`, this subtree) are the public source of truth for spec and scope. Pre-public planning history lives in the maintainer's internal planning archive and is not needed to work here.
