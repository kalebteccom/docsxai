# docsxai — agent operating guide

Authoritative, agent-agnostic working rules for this repository. Every harness loads this file (Claude Code via `CLAUDE.md`, Cursor via `.cursor/rules/00-substrate.mdc`, Codex via `.codex/config.toml`, and any AGENTS.md-conformant harness directly). **Per-harness pointers reference this file; they never duplicate its content.** When a rule changes here, every harness picks it up on the next session — no per-harness edits required.

## Substrate at a glance

docsxai is an LLM-agnostic engine + Claude Code plugin that walks a web application, follows written flows, and emits screenshot-rich user documentation. The engine ships the `docsxai` CLI binary, a deterministic Playwright-backed runtime, calibration-aid helpers (`lint`, `diagnose`, `flow-tree`, `style`), the flow-file parser, and the target-site auth strategies. The plugin is the first-class invocation surface that drives calibration through any MCP-speaking host agent. A small authenticated backend persists doc packs. The product, the CLI, and the npm scope all share one name: `docsxai` (GitHub repo `kalebteccom/docsxai`, npm org `@docsxai`).

The architecture splits into two modes: **calibration** (AI-assisted, rare; host agent + browser bridge author flows) and **execution** (deterministic, continuous; `docsxai run` replays the doc pack with zero agent involvement, zero LLM calls). The engine never imports a model-provider SDK — that boundary is load-bearing.

## Operating rules

- **Commits.** Single-line conventional-commit subjects (`type(scope): subject` or `type: subject`), **≤72 characters**, no body, **no AI-attribution trailers**. The repo's `.claude/hooks/block-*.sh` enforces this on visible `git commit -m` invocations. Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- **Package manager.** Use `pnpm` (≥9). Never `npm` or `yarn`. The repo uses pnpm via Corepack.
- **Filenames.** kebab-case for all new files and directories.
- **Preserve user work.** Never run `git reset`, `git checkout <path>`, `git clean`, or `git revert` without explicit user request. If a working tree looks broken, surface it — don't sweep it.
- **Search with `rg`.** Prefer `rg` / `rg --files` over `grep` / `find` for searching.
- **Code is the source of truth.** Before naming an API, import, schema field, config key, or generated type — read the file. Plan snippets, memory, and old review notes can be stale. Hallucinated APIs are a recurring failure mode.
- **No internal tracker IDs in source or comments.** Ticket / plan / round / PR refs (`W-X#`, `Round-N`, `ask #N`, `TICKET-N`, `JIRA-N`, `#1234`) are project-management artifacts, not code context — they rot, mean nothing to a future reader, and belong in the commit/PR body. State the actual reason instead: write _why_ the code is the way it is, not _which ticket asked for it_.

### Naming policy

One name everywhere: the product, the GitHub repo (`kalebteccom/docsxai`), the CLI command (`docsxai`), and the npm org (`@docsxai`, registered) are all `docsxai`. Scoped packages are `@docsxai/<name>` (bins `docsxai-<name>`); the bare `docsxai` package is the batteries-included CLI meta-package (bin wraps `@docsxai/engine`'s CLI in-process; depends on `@docsxai/viewer` so `render` works from one global install). Env vars use the `DOCSX_*` prefix (family precedent: browxai's `BROWX_*`), the workspace config file is `.docsxai.json`, schema ids are `docsxai/<thing>@N`, and the backend API version header is `Docsxai-Api-Version`. This replaced the old codename-stability rule (the `site-docs` CLI / `SITE_DOCS_*` / `.site-docs.json` surfaces) by owner decision on 2026-06-12 — a pre-publish clean break with no compatibility aliases; nothing had shipped, so nothing was kept. The only deliberate survivor: the plugin runtime keeps `site-docs` in `RESERVED_NAMESPACES` so no plugin can squat the old identity.

## Commands the agent must not run

Agents reading this file must not invoke the commands below unless the operator explicitly authorizes the specific invocation in the same session.

| Pattern                                                             | Decision       | Why                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm publish`, `npm publish`                                       | forbidden      | Releases go through OIDC trusted publishing in `release.yml`. No human or agent runs publish locally (baseline rule 8).                               |
| `npm install -g <anything>`                                         | prompt         | Global installs are a typosquat vector and route around the project lockfile (baseline rules 41 / 49).                                                |
| `git push --force` (and `--force-with-lease` to protected branches) | forbidden      | Branch ruleset rejects this server-side; the agent layer is defense-in-depth (baseline rule 26).                                                      |
| `pnpm -C packages/engine exec playwright-core install chromium`     | explicit allow | Documented Playwright/Chromium fetch — the legit exception to `--ignore-scripts` (baseline rule 39). Must not be blocked by any blanket install rule. |
| `gh pr merge --admin`                                               | forbidden      | Bypasses branch protection and CODEOWNERS review (baseline rules 25 / 26).                                                                            |
| `curl <url> \| bash`, `wget <url> \| bash`                          | forbidden      | Unverified pipe-to-shell is the Codecov-2021 class. Fetch + SHA-256 verify instead (baseline rule 41).                                                |
| `git reset --hard`                                                  | forbidden      | Never discard local work. Use a targeted revert if asked.                                                                                             |
| `git checkout -- <path>`                                            | forbidden      | Never overwrite local files with checkout.                                                                                                            |
| `git clean`                                                         | prompt         | Deletes untracked work; needs explicit operator review.                                                                                               |
| `rm -rf`                                                            | prompt         | Recursive deletion needs explicit operator review.                                                                                                    |

Enforcement is idiomatic per harness: hard-blocks land in the Claude Code `PreToolUse` hooks under `.claude/hooks/` and equivalents for Codex / Cursor; advisory where not yet wired.

## Repo map

- `packages/engine/` — `@docsxai/engine`. The flow-file parser + deterministic runtime, the `docsxai` CLI (`init`, `capture-auth`, `calibrate`, `inspect`, `run`, `render`, `lint`, `flow-tree`, `diagnose`, `style`, `zip`, `plugins`, `export`, `push`, `pull`, `login`, plus drift tooling as it lands), the target-site auth-strategy catalogue (`src/auth/`), the workspace plugin runtime (`src/plugins/` — publishers / renderers / lint-rules / auth-strategies), pure exporters (`src/export/`), the `BrowserDriver` interface + `PlaywrightDriver` implementation, calibration-aid helpers. The engine never calls a model API — that's the load-bearing contract.
- `packages/plugin/` — `@docsxai/plugin`. The Claude Code plugin: calibrate + diagnose skills, run/render/login commands, internal MCP registration. The recommended invocation surface for agent-driven workflows.
- `packages/backend/` — `@docsxai/backend`. Authenticated doc-pack persistence service: REST + per-resource endpoints, filesystem or in-memory store, content-addressed blobs, finalized linear-immutable revisions, OAuth 2.1 + PKCE (CI bearer path retained), client-side-encrypted auth-cache relay, and the GitHub App webhook surface (signed dispatch → deterministic execution → output strategies). Loopback by default; hosted deployment is owner-gated.
- `packages/skill/` — `@docsxai/skill`. Optional vendorable `.claude/skills/` fallback that delegates to the installed plugin. For teams that prefer version-pinning in the consumer repo.
- `packages/mcp/` — `@docsxai/mcp`. Standalone stdio MCP server (`docsxai-mcp` bin) for any MCP-speaking host: calibration meta-orchestration + read-only doc-pack introspection over the engine surface. No browser primitives — live-page discovery is browxai's. Tool registry discipline: `docs/ai-context/tool-registration/mcp-tool-registry.md`.
- `packages/viewer/` — `@docsxai/viewer`. The rendering surface: single-file interactive viewer (halo + numbered badges + Popper-placed callouts over clean screenshots), the browser-free `burn` renderer (Satori + resvg baked annotations for static delivery), and the Astro Starlight site emitter (production docs-site output).
- `packages/plugin-confluence/` — `@docsxai/plugin-confluence`. First-party publisher plugin (`confluence:push`): idempotent Confluence Cloud REST v2 push behind the `egress:*.atlassian.net` capability. The reference implementation for publisher plugins.
- `packages/plugin-starlight/` — `@docsxai/plugin-starlight`. First-party renderer plugin (`starlight:site`) wrapping the viewer's Starlight emitter.
- `docs/` — runbooks + cross-repo contracts: `agent-runbook.md`, `agent-guidance.md` (the reach-for-this-not-that footgun map for calibration agents), `running-against-an-app-repo.md`, `actionability-contract.md` (portable `actionable()` predicate contract for browser-bridge consumers), `browxai-asks.md` (integration contract with the discovery driver).
- `docs/archive/phase-plans/PHASE-0.md`, `docs/archive/phase-plans/PHASE-1.md` — archived phase closure summaries; kept for design-rationale archaeology, not live references.
- `RELEASING.md` — gated go-public checklist (release is owner-deferred).

## Trust + execution posture

Safe by default. The engine reads URLs the operator provides, captures screenshots and text, and **never executes JavaScript the visited site provides** in any privileged context. All page interaction goes through Playwright's locator API and a curated step vocabulary (`click`, `fill`, `select`, `wait_for`, `assert`, …). Flow-files are parsed against a Zod schema; nothing in the flow is `eval`'d.

Surface-by-surface:

| Surface       | Trust posture                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine (CLI)  | No model API calls — ever. Reads target URLs the operator names; writes only under the configured workspace root. Auth strategies cache cookies/tokens; secrets never appear in artifacts. |
| Plugin        | Runs inside Claude Code's plugin sandbox. Delegates execution to the engine binary. Calibration skills emit structured questions; commands are deterministic engine invocations.           |
| Backend       | Stateless HTTP surface, loopback by default. OAuth 2.1 auth wires hosted deployment post-MVP. No code execution surface beyond CRUD on doc-pack resources.                                 |
| Viewer        | Static HTML; no runtime fetch from third-party CDNs. CSP `default-src 'none'` posture on emitted pages.                                                                                    |
| `docsxai run` | Deterministic. No agent in the loop. Same flow-file + same target state → byte-identical doc pack (keystone-enforced).                                                                     |

Egress boundary: the engine's only built-in outbound HTTP path is the backend client (`backend-client.ts`), besides the target-site navigation Playwright drives. Wiki/VCS egress lives exclusively in capability-declared publisher plugins and the backend — the engine core emits projections (files/payloads) only.

## Build + run discipline — the dist-rebuild trap

`docsxai` runs the compiled `packages/engine/dist/cli.js`. **Source changes are NOT live until `pnpm -r build`.** A stale `dist/` that predates a runtime change can crash the CLI at startup or, worse, silently run old behaviour against new tests.

- After any source change, rebuild: `pnpm -r build`.
- A running Claude Code / Codex session may hold the plugin daemon process in memory. Node's `import()` is one-shot at boot. Any `dist/` rebuild after the daemon started means the running daemon is executing stale code. **Restart the daemon and surface the new PID explicitly to the operator** before declaring the change verified.
- Before pushing: `pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build` — all exit 0. CI runs the same gate. The keystone test (`packages/engine/test/keystone.test.ts`) requires Chromium; it's the regression gate for runtime behaviour.

## Two-mode architecture — the load-bearing split

The engine has two modes — **calibration** (AI-assisted, rare) and **execution** (deterministic, continuous). The split is load-bearing:

- The engine **never** calls a model API. The host agent supplies inference at calibration time; execution has no agent in the loop.
- `docsxai run` reproduces a doc pack byte-identically from the same flow-file + same target state. The keystone test asserts this against a real browser.
- Adding model-provider code anywhere in `packages/{engine,plugin,backend,viewer,skill}/` is a contract violation. The future commercial SaaS surface is the only place provider SDKs live, and it's not in this repo.

Write-time signal beats run-time control. `actionable()`, the halt-cause prefix, `lint`, `diagnose`, `flow-tree` — these let the calibration agent decide _before_ committing a step whether it'll hold. Future contract work biases here; do not re-introduce in-engine agent-orchestration state machines (the dropped `DiscoveryStage`/`MappingStage`/`CommitStage` design is the cautionary tale; see the `docs/archive/phase-plans/PHASE-1.md` postmortem).

## Browser-driver decoupling

The engine sits behind a `BrowserDriver` interface, not hard-wired to Playwright. The one Playwright integration point (`PlaywrightDriver`) stays small. This is what lets browxai slot in as the model-agnostic discovery driver during calibration. Keep this boundary sharp — any new browser-touching surface goes through `BrowserDriver`, not a direct Playwright import.

## Conditional UI + the flow-file format

"The happy path always happens" is the wrong default for real SPAs. Modals-that-sometimes-appear, first-run tooltips, cookie banners — `optional: true` on a step is the first-class affordance. Don't hack conditionality into selectors; declare it in the flow.

## Workspace + paths

All file IO is workspace-rooted, never `cwd`. A `docsxai` workspace is the directory passed as the CLI argument (e.g. `~/docsxai/my-app`); all artifacts (flow-files, `annotations.json`, screenshots, locator manifest, auth descriptor, halt context, viewer output) live under it. Internal Kalebtec paths do not appear in code, comments, tests, or public docs.

## Worktree conventions

Parallel agents that modify the same working tree collide. Dispatch multi-agent work into git worktrees under `.worktrees/` (or `<repo-parent>/<repo>-worktrees/<phase>/`). One agent = one worktree = one branch. Sibling agents declare ownership boundaries up front to avoid file conflicts at merge.

## Documentation contracts

Three doc surfaces with distinct contracts:

- **`docs/`** — public adopter contract. Runbooks (`agent-runbook.md`, `running-against-an-app-repo.md`) and cross-repo contracts (`actionability-contract.md`, `browxai-asks.md`). Every public behavior change updates the relevant runbook.
- **Colocated `README.md`** — per-package internal contracts (`packages/engine/README.md`, `packages/plugin/README.md`, …). Each package describes its own surface, not the whole repo.
- **`docs/archive/phase-plans/PHASE-N.md`** — archived phase closure summaries, snapshotted as each phase closed. Source of truth for current spec/scope is the repo-local docs (`AGENTS.md`, `docs/`, `docs/ai-context/`); these archives are kept for design-rationale archaeology.

Every behavior-change diff includes a docs-impact pass: update the relevant runbook, update `CHANGELOG.md`, update `AGENTS.md` if a rule changed, and surface scope/shape movement to the owner so the internal planning archive stays current.

## What to read first

For a new agent session in this repo, read in order:

1. `README.md` — substrate at a glance + install + quick start + package map.
2. This file (`AGENTS.md`) — operating rules + repo map + trust posture.
3. `docs/ai-context/README.md` — agent-facing routing layer; points at the right subdir for the area you're touching. For any change that moves a boundary, adds a world-touching surface, or sits on a hot path, read `docs/ai-context/architecture/architecture-principles.md` (the Kalebtec architecture doctrine) alongside `docs/ai-context/agent-process/code-quality.md`. For where new code goes and what to call it, read `docs/ai-context/architecture/hexagonal-and-ddd.md` (the layer map + ubiquitous language); for the one-reason-to-change file/module size budget, `docs/ai-context/architecture/module-and-file-size.md`; for what is mechanically enforced, `docs/ai-context/architecture/fitness-functions.md`.
4. `docs/archive/phase-plans/PHASE-1.md` — closure narrative + agent-integration-contract postmortem (it's the single best source for _why_ the engine is shaped the way it is).
5. `docs/agent-runbook.md` — the hand-to-an-agent workflow for calibration.
6. The package READMEs under `packages/*/README.md` for the area you're touching.
7. `docs/actionability-contract.md` + `docs/browxai-asks.md` for browser-bridge work.

## Multi-harness auto-discovery

`AGENTS.md` is the single source of truth. Per-harness pointer files reference this file and never duplicate content:

- **Claude Code:** `CLAUDE.md` at repo root — short pointer to `AGENTS.md`. Claude-Code-specific addenda (hooks, Skills) live under `.claude/`.
- **Cursor:** `.cursor/rules/00-substrate.mdc` — MDC frontmatter with `alwaysApply: true`, body `@AGENTS.md`.
- **Codex:** `.codex/config.toml` references `AGENTS.md` as the canonical rules file. Expert agent definitions live in `.codex/agents/`.
- **AGENTS.md-conformant harnesses** (future): load `AGENTS.md` directly. No further config needed.

Adding a new harness: place a pointer file in the harness's discovery location, reference `AGENTS.md`. Do not copy rules.

## Quality gate contract

All of the following must exit 0 on a clean branch before pushing:

```
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
pnpm depcruise
pnpm jscpd:check
```

`pnpm depcruise` is the graph-level layering gate (no runtime import cycles; the
no-`playwright-core`-outside-the-driver and no-model-SDK bans are additionally
enforced by eslint). `pnpm jscpd:check` is the duplication budget. Both are part
of the gate; see `docs/ai-context/architecture/fitness-functions.md`.

The keystone test (`packages/engine/test/keystone.test.ts`) requires Chromium and runs the runtime end-to-end against a real browser — run it for anything touching page interaction, the runtime, or auth strategies.

Every behavior-change diff verifies this gate locally before pushing — never push and hope CI catches it. CI runs the same gate; a CI failure on push is a self-inflicted wound.

## Related

- [`SECURITY.md`](SECURITY.md) — vulnerability reporting + trust posture.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor workflow + DCO posture.
- [`MAINTAINERS.md`](MAINTAINERS.md) — maintainer roster + decision-making.
- [`RELEASING.md`](RELEASING.md) — gated go-public checklist.
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — runtime third-party dependencies.
