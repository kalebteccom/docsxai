# `docs/ai-context/` — agent-facing routing layer

This subtree is the **agent-facing** companion to the public `docs/` runbooks. It is **not** part of any published documentation site; it lives in the repo so every harness has the same context and so the discipline is version-controlled with the code it governs.

## Read this before touching the relevant area

- Moving a boundary, adding a world-touching surface, or working a hot path → read [`architecture/architecture-principles.md`](architecture/architecture-principles.md) (macro doctrine) alongside [`agent-process/code-quality.md`](agent-process/code-quality.md) (micro layer).
- Figuring out where new code goes, or what to call it → read [`architecture/hexagonal-and-ddd.md`](architecture/hexagonal-and-ddd.md) (the layer map, ubiquitous language, the where-does-it-go rule).
- Creating or splitting a file/module → read [`architecture/module-and-file-size.md`](architecture/module-and-file-size.md) (the one-reason-to-change size budget and its ratchet).
- Adding an architectural guarantee, or before relying on one → read [`architecture/fitness-functions.md`](architecture/fitness-functions.md) (what is mechanically enforced vs. still an aspiration).
- Touching flow expansion (`matrix:`, `only`/`skip`, `copy_by_locale`), the per-variant output layout under `docs/<flow>/<variant>/`, or the `run` unit loop → read [`architecture/flow-matrix-decision.md`](architecture/flow-matrix-decision.md); [`matrix-adoption-notes.md`](matrix-adoption-notes.md) shows the trackxai and remotxai flows on it.
- Adopting `pack` or `pack --check` on a matrix workspace, or wiring either into CI → read [`trackxai-adoption-answers.md`](trackxai-adoption-answers.md) (what `pack` can and cannot read, the id and key grammars, the drift gate, install and `oxipng`).
- Changing a public page that names a `docsxai` command, a flag, a `DOCSX_*` variable or whether a package is published → read [`ux/docs-accuracy-v2.md`](ux/docs-accuracy-v2.md) (what was checked against which code, and what is repo-only on purpose); `packages/engine/test/docs-cli-mentions.test.ts` fails on a command or flag that `docsxai --help` does not list.
- Adding a CLI subcommand or plugin command → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`architecture/documentation-contracts.md`](architecture/documentation-contracts.md).
- Adding a tool to the standalone MCP server (`packages/mcp/`) → read [`tool-registration/mcp-tool-registry.md`](tool-registration/mcp-tool-registry.md).
- Writing a test → read [`testing/tdd-and-test-strategy.md`](testing/tdd-and-test-strategy.md) (test-first workflow + the layers), [`testing/qa-patterns.md`](testing/qa-patterns.md), and [`testing/unit-vs-keystone.md`](testing/unit-vs-keystone.md).
- Writing or touching a plugin (publisher / renderer / lint-rules / auth-strategy) → read [`plugin-runtime/lifecycle-and-namespacing.md`](plugin-runtime/lifecycle-and-namespacing.md).
- Adding any gated/acting surface (MCP tool, plugin kind, auth strategy, webhook, output strategy) → read [`architecture/capability-posture-map.md`](architecture/capability-posture-map.md) and [`secrets-and-egress/auth-catalogue-and-masking.md`](secrets-and-egress/auth-catalogue-and-masking.md).
- Editing a plugin command, a plugin skill or the vendored skill (`packages/plugin/commands/`, `packages/plugin/skills/`, `packages/skill/skill/`) → read [`ux/plugin-audit.md`](ux/plugin-audit.md). `packages/plugin/test/cli-usage.test.ts` fails when their `docsxai ...` examples drift from `docsxai --help`.
- Changing the interactive viewer's markup, styles or overlay runtime (`packages/viewer/src/render.ts`, `viewer-*.ts`, `overlay-runtime.ts`) → read [`ux/viewer-audit.md`](ux/viewer-audit.md).
- Changing a tool description, an input schema or an error message in `packages/mcp` → read [`ux/mcp-audit.md`](ux/mcp-audit.md).
- Adding or tuning a static accessibility rule, or the CI step that lints built HTML → read [`ux/static-checks.md`](ux/static-checks.md).
- Touching the engine runtime, the `BrowserDriver` interface, or auth strategies → read [`architecture/surface-map.md`](architecture/surface-map.md) and [`testing/qa-patterns.md`](testing/qa-patterns.md) — the keystone test is the regression gate.
- Touching any code path that writes artifacts (screenshots, annotations, halt context, doc-pack zip) → read [`secrets-and-egress/README.md`](secrets-and-egress/README.md).
- Releasing or changing the surface → read [`release-process/semver-clock.md`](release-process/semver-clock.md) and [`../public-surface.md`](../public-surface.md). A change to a pinned surface trips a contract test (`packages/*/test/contract/`); the update procedure is in each test file's header.
- Editing a commit message or pushing without local verify → read [`agent-process/commit-discipline.md`](agent-process/commit-discipline.md) and [`agent-process/dist-rebuild-discipline.md`](agent-process/dist-rebuild-discipline.md).

## Information architecture

| Subdir                | Purpose                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-process/`      | Cross-cutting discipline: commits, dist-rebuild, the cross-cutting code-quality doctrine.                                                                                                                                                                               |
| `architecture/`       | Substrate references: the Kalebtec architecture-principles doctrine, the hexagonal/DDD layer map + ubiquitous language, the module/file-size discipline, the fitness-function index, surface map across the nine packages, capability posture, documentation contracts. |
| `secrets-and-egress/` | Trust posture for everything that writes to disk or surfaces text. No in-engine JS-injection surface; the trust surface is auth artifacts, screenshots, and halt context.                                                                                               |
| `plugin-runtime/`     | Plugin lifecycle, namespacing, capability + lock discipline for the workspace plugin runtime (publishers / renderers / lint-rules / auth-strategies).                                                                                                                   |
| `tool-registration/`  | The MCP tool registry discipline for `packages/mcp/`: one tool = one file, registry composed only in `server.ts`, the add-a-tool checklist.                                                                                                                             |
| `ux/`                 | Read-throughs of user-facing output (CLI messages, help text) with what was fixed and what was left.                                                                                                                                                                    |
| `testing/`            | Unit / keystone layering and the QA-patterns playbook.                                                                                                                                                                                                                  |
| `release-process/`    | Semver clock, branch-protection reference, the public-flip checklist.                                                                                                                                                                                                   |
| `ux/`                 | UX audits of emitted surfaces (the interactive viewer): findings, fixes, what still needs a browser to check.                                                                                                                                                           |
| `investigations/`     | Root-cause write-ups for non-obvious bugs. Each one-off entry lands as `<YYYY-MM-DD>-<slug>.md`.                                                                                                                                                                        |
| `adopter-reports/`    | Field reports from teams driving docsxai against real workloads. Each report lands as a dated entry.                                                                                                                                                                    |
| `ux/`                 | UX and accessibility audits of the docs site (`website/`): findings, contrast measurements, what still needs a browser.                                                                                                                                                 |

## How this differs from the public `docs/` runbooks

|                | `docs/` (public)                                                        | `docs/ai-context/` (agent-facing)                                  |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Audience       | adopters integrating docsxai                                            | agents and contributors working _on_ docsxai                       |
| Promise        | public API contract (CLI surface, flow-file schema, ActionResult shape) | working discipline + the standing design rationale that governs it |
| Published      | yes (when a docs site lands; the runbooks are repo-only markdown)       | no, repo-only                                                      |
| Versioned with | semver-frozen surface                                                   | code                                                               |
| Read when      | integrating, debugging adopter-side                                     | making changes here                                                |

## Source-of-truth pointers

- `AGENTS.md` (repo root) — operating rules + repo map + trust posture. The agent-agnostic entry point. Every harness loads it.
- `docs/archive/phase-plans/PHASE-0.md`, `docs/archive/phase-plans/PHASE-1.md` — the recorded decision history behind the engine's fixed boundaries. Consult `PHASE-1.md` for the rationale behind the agent-integration contract; the standing spec and scope live in `AGENTS.md`, `docs/`, and this subtree, not here.

Repo-local docs (`AGENTS.md`, `docs/`, this subtree) are the public source of truth for spec and scope. Pre-public planning history lives in the maintainer's internal planning archive and is not needed to work here.
