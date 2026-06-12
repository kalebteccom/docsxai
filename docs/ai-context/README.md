# `docs/ai-context/` — agent-facing routing layer

This subtree is the **agent-facing** companion to the public `docs/` runbooks. It is **not** part of any published documentation site; it lives in the repo so every harness has the same context and so the discipline is version-controlled with the code it governs.

## Read this before touching the relevant area

- Adding a CLI subcommand or plugin command → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`architecture/documentation-contracts.md`](architecture/documentation-contracts.md).
- Adding a tool to the standalone MCP server (`packages/mcp/`) → read [`tool-registration/mcp-tool-registry.md`](tool-registration/mcp-tool-registry.md).
- Writing a test → read [`testing/qa-patterns.md`](testing/qa-patterns.md) and [`testing/unit-vs-keystone.md`](testing/unit-vs-keystone.md).
- Writing or touching a plugin (publisher / renderer / lint-rules / auth-strategy) → read [`plugin-runtime/lifecycle-and-namespacing.md`](plugin-runtime/lifecycle-and-namespacing.md).
- Touching the engine runtime, the `BrowserDriver` interface, or auth strategies → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`testing/qa-patterns.md`](testing/qa-patterns.md) — the keystone test is the regression gate.
- Touching any code path that writes artifacts (screenshots, annotations, halt context, doc-pack zip) → read [`secrets-and-egress/README.md`](secrets-and-egress/README.md).
- Releasing or changing the surface → read [`release-process/semver-clock.md`](release-process/semver-clock.md).
- Editing a commit message or pushing without local verify → read [`agent-process/commit-discipline.md`](agent-process/commit-discipline.md) and [`agent-process/dist-rebuild-discipline.md`](agent-process/dist-rebuild-discipline.md).

## Information architecture

| Subdir                | Purpose                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-process/`      | Cross-cutting discipline: commits, dist-rebuild, code quality (the f3-inspired big one).                                                                                  |
| `architecture/`       | Substrate references: surface map across the five packages, documentation contracts between layers.                                                                       |
| `secrets-and-egress/` | Trust posture for everything that writes to disk or surfaces text. No in-engine JS-injection surface; the trust surface is auth artifacts, screenshots, and halt context. |
| `plugin-runtime/`     | Plugin lifecycle, namespacing, capability + lock discipline for the workspace plugin runtime (publishers / renderers / lint-rules / auth-strategies).                     |
| `tool-registration/`  | The MCP tool registry discipline for `packages/mcp/`: one tool = one file, registry composed only in `server.ts`, the add-a-tool checklist.                               |
| `testing/`            | Unit / keystone layering and the QA-patterns playbook.                                                                                                                    |
| `release-process/`    | Semver clock, branch-protection stub (matures in D4).                                                                                                                     |
| `investigations/`     | Root-cause write-ups for non-obvious bugs. Empty today; one-off entries land as `<YYYY-MM-DD>-<slug>.md`.                                                                 |
| `adopter-reports/`    | Field reports from teams driving docsxai against real workloads. Empty today; reports land as dated entries.                                                              |

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
- The portfolio `projects/automated-site-documentation-bot/` in [`project-ideas`](https://github.com/kalebteccom/project-ideas) — canonical `spec.md` / `roadmap.md` / `progress.md`.
