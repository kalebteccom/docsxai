# Contributing to docsxai

Thanks for your interest. docsxai is Apache-2.0 licensed; contributions are welcome.

## Where the design lives

This repo is the _implementation_. The **canonical spec, roadmap, and progress log** live in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio repo under `projects/automated-site-documentation-bot/`. Read those first if you're changing scope or design shape; treat them as the source of truth and update them in lockstep with implementation changes.

For browser-bridge / discovery-driver concerns, the cross-repo contract is at [`docs/browxai-asks.md`](docs/browxai-asks.md); the portable actionability predicate is at [`docs/actionability-contract.md`](docs/actionability-contract.md).

## Development setup

```bash
corepack enable                                              # provides pnpm 9.x
pnpm install
pnpm -C packages/engine exec playwright-core install chromium   # needed for the keystone test + `site-docs run`
```

Node 20+. Package manager is pnpm 9.x.

Checks (all must pass before a PR merges — CI runs them):

```bash
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest unit suite + keystone where present
pnpm build                    # tsc → dist/ for every package
```

The unit suite is fast and browser-free. The **keystone**
(`packages/engine/test/keystone.test.ts`) drives a real headless
Chromium end-to-end through the engine's runtime + the `site-docs run`
path — it's the regression gate for anything touching page interaction,
the runtime, auth strategies, or the deterministic-replay contract.

## Repo layout

```
packages/
  engine/    @kalebtec/docsxai-engine    — flow-file runtime, CLI, auth strategies
  plugin/    @kalebtec/docsxai-plugin    — Claude Code plugin (the invocation surface)
  backend/   @kalebtec/docsxai-backend   — auth'd persistence (stub today)
  skill/     @kalebtec/docsxai-skill     — vendorable .claude/skills/ fallback
  viewer/    @kalebtec/docsxai-viewer    — static-HTML viewer
docs/        runbooks + cross-repo contracts (browser-bridge integration, actionability)
```

## Code conventions

- **TypeScript strict.** No `any` in published surfaces.
- **ESM only** (`"type": "module"`). All cross-package imports use `.js` extensions in source.
- **Tests sit alongside code** as `<name>.test.ts` under each package's `test/`. Vitest. New code ships with a test.
- **Don't add error handling for impossible states.** Trust internal code and framework guarantees; only validate at system boundaries.
- **Default to writing no comments.** Only add one when the _why_ is non-obvious — a hidden constraint, a workaround, behavior that would surprise a future reader.
- **No backwards-compatibility shims** for unused code paths. Delete unused exports cleanly.
- **No internal tracker IDs in code or comments.** Ticket / plan / round / PR refs (`W-X#`, `Round-N`, ticket numbers) belong in commit/PR bodies, not in source. State the actual reason instead.
- **No model-provider SDKs** anywhere in `packages/{engine,plugin,backend,viewer,skill}/`. The engine is LLM-agnostic by design; the host agent supplies inference at calibration time. Importing a provider SDK in this repo is a contract violation.

## Two-mode architecture (read before editing the runtime)

The engine has two modes — **calibration** (AI-assisted, rare) and **execution** (deterministic, continuous). The split is load-bearing:

- The engine **never** calls a model API. The host agent supplies inference at calibration time; execution has no agent in the loop.
- `site-docs run` reproduces a doc pack byte-identically from the same flow-file + same target state. The keystone test asserts this against a real browser.
- Adding model-provider code anywhere in `packages/{engine,plugin,backend,viewer,skill}/` is a contract violation. The future commercial SaaS surface is the only place provider SDKs live, and it's not in this repo.

## Commits

- **Single-line conventional-commit subjects, ≤72 chars.** No body, no AI trailers. Hook-enforced (`.claude/hooks/`); don't bypass them.
- **One logical change per commit.** Don't `git add .` — stage paths explicitly with `git add <paths>`.
- For a multi-package change, one commit per package unless the change is genuinely atomic.
- Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

Examples:

```
feat(engine): actionability predicate + portable consumer contract
fix(viewer): clamp nudge offsets to image bounds
docs(agent-runbook): document the calibration discovery driver
```

## Developer Certificate of Origin (DCO)

We require contributors to sign off on commits with `git commit -s`. This adds a `Signed-off-by:` trailer that attests you wrote (or have the right to contribute) the change under the project's license. We use DCO instead of a CLA. The DCO text lives at https://developercertificate.org/.

## Branch model

- Feature branches off `main`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`, `test/<slug>`, `refactor/<slug>`.
- Open a PR against `main`. One maintainer review is required (enforced by CODEOWNERS once the CODEOWNERS file lands).
- Squash-merge is the default. Keep the subject conformant — it becomes the squashed-commit subject.
- Draft PRs are welcome for in-flight design conversation.

## Pull requests

1. Branch, make the change, add tests, keep `pnpm typecheck` / `pnpm test` / `pnpm build` green.
2. Update the relevant runbook (`docs/agent-runbook.md`, `docs/running-against-an-app-repo.md`) for any user-facing surface change.
3. Update `CHANGELOG.md` under `## Unreleased`.
4. Open a PR; describe the _why_.

For non-trivial changes, open an issue first so we can align on shape — the design docs in the portfolio repo are the place to anchor that discussion.

## Stability & the public surface

docsxai will follow semver post-v1.0. Until v1.0, the public API may change at any time; we will still note breaking changes in `CHANGELOG.md`.

The **stable surface** post-v1.0 — `site-docs` subcommand names + documented flags, flow-file schema, doc-pack output shape, the actionability-contract predicate, the `BrowserDriver` interface, the backend's REST surface — does not change in a `patch`; an additive change is a `minor`; a breaking change requires a `major` bump plus a changelog entry and a deprecation note.

## Plugin contribution guide

To contribute to the Claude Code plugin (`@kalebtec/docsxai-plugin`):

1. Confirm the contribution is plugin-shaped, not engine-shaped. New capability lives in the engine; the plugin exposes it. A pure plugin-only change is something like adding a skill, refining the calibrate workflow, or adjusting command UX.
2. Plugin skills live under `packages/plugin/skills/`; plugin commands live under `packages/plugin/commands/`. Follow the existing structure.
3. Plugin skills emit structured questions through Claude Code's question API and shell out to `site-docs`. They do not embed their own runtime; the engine binary is the single source of behaviour.
4. Plugin commands are deterministic `site-docs` invocations. They wrap the CLI; they don't reach into the engine's internals.
5. Add a test under `packages/plugin/test/`.
6. Update the package README at `packages/plugin/README.md` if the surface changed.
7. Note the change in `CHANGELOG.md` under `## Unreleased ### Plugin`.

The plugin's job is to be the recommended invocation surface — not to add capability the engine doesn't have. If a contribution feels like it needs new engine behaviour, raise that first as an engine PR.

## Filing issues

- Reproducer minimal? Good.
- For engine issues: mention the engine version (`pnpm -C packages/engine list` or `site-docs --version`), Node version, and platform.
- For browser-related issues: include the Playwright version and whether you're attached over CDP (`--cdp http://localhost:9222`) or launched fresh.
- For plugin issues: include the plugin manifest version, the Claude Code version, and the calibrate-skill output that caused the failure.
- For viewer issues: include a screenshot of the rendered viewer, the doc-pack `annotations.json`, and the browser + version you opened it in.
- For backend issues: include the backend version, the request payload (with secrets redacted), and the response.

For security-sensitive reports, please follow [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## Workspace-rooted paths

Every transient path docsxai writes lives under the workspace directory the operator passes to the CLI (e.g. `~/site-docs/my-app`). Code never writes to `$HOME`, `cwd`, or `/tmp` directly. Internal Kalebtec paths do not appear in code, comments, tests, or public docs.

## Issue label conventions

We use these label families on issues and PRs:

- `area::engine|plugin|backend|viewer|skill|docs`
- `phase::triage|accepted|in-progress`
- `severity::critical|high|normal|low`
- `kind::bug|feat|chore|docs|security|proposal`

## Bot allowlist

See `.github/BOT_ALLOWLIST.md` (lands with the launch-gate phase). New GitHub Apps that require write access require owner approval and a rationale entry in `SECURITY.md`.

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](LICENSE).
