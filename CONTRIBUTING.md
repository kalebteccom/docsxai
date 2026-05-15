# Contributing

Thanks for your interest. A few conventions to know before sending PRs.

## Where the design lives

This repo is the *implementation*. The **canonical spec, roadmap, and progress log** live in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio repo under `projects/automated-site-documentation-bot/`. Read those first if you're changing scope or design shape; treat them as the source of truth and update them in lockstep with implementation changes.

For browser-bridge / discovery-driver concerns, the cross-repo contract is at [`docs/browxai-asks.md`](docs/browxai-asks.md); the portable actionability predicate is at [`docs/actionability-contract.md`](docs/actionability-contract.md).

## Dev setup

```bash
corepack enable
pnpm install
pnpm -C packages/engine exec playwright-core install chromium  # needed for the keystone test + `site-docs run`
pnpm typecheck
pnpm test
pnpm build
```

Node 20+. Package manager is pnpm 9.x.

## Repo layout

```
packages/
  engine/    @kalebtec/site-docs-engine    — flow-file runtime, CLI, auth strategies
  plugin/    @kalebtec/site-docs-plugin    — Claude Code plugin (the invocation surface)
  backend/   @kalebtec/site-docs-backend   — auth'd persistence (stub today)
  skill/     @kalebtec/site-docs-skill     — vendorable .claude/skills/ fallback
  viewer/    @kalebtec/site-docs-viewer    — static-HTML viewer
docs/        runbooks + cross-repo contracts (browxai, actionability)
examples/    public toy-site flows + fixtures used by the keystone test
```

## Code conventions

- **TypeScript strict**; no `any` in published surfaces.
- **ESM only** (`"type": "module"`). All cross-package imports use `.js` extensions in source.
- **Tests sit alongside code** as `<name>.test.ts` under each package's `test/`. Vitest. New code ships with a test.
- **Don't add error handling for impossible states.** Trust internal code and framework guarantees; only validate at system boundaries.
- **Default to writing no comments.** Only add one when the *why* is non-obvious — a hidden constraint, a workaround, behavior that would surprise a future reader.
- **No backwards-compatibility shims** for unused code paths. Delete unused exports cleanly.

## Commits

- **Single-line conventional-commit subjects, ≤72 chars.** No body, no AI trailers. Hook-enforced (`.claude/hooks/`).
- One logical change per commit. Don't `git add .` — stage paths explicitly.
- For a multi-package change, one commit per package unless the change is genuinely atomic.

Examples:

```
feat(engine): actionability predicate + contract for browxai consumers
fix(viewer): clamp nudge offsets to image bounds
docs: integrate browxai as canonical discovery driver
```

## Two-mode architecture (read before editing the runtime)

The engine has two modes — **calibration** (AI-assisted, rare) and **execution** (deterministic, continuous). The split is load-bearing:

- The engine **never** calls a model API. The host agent supplies inference at calibration time; execution has no agent in the loop.
- `site-docs run` reproduces a doc pack byte-identically from the same flow-file + same target state. The keystone test (`packages/engine/test/keystone.test.ts`) asserts this against a real browser.
- Adding model-provider code anywhere in `packages/{engine,plugin,backend,viewer,skill}/` is a contract violation. The future commercial SaaS surface is the only place provider SDKs live, and it's not in this repo.

## Filing issues

- Reproducer minimal? Good.
- Mention the engine version (`pnpm -C packages/engine list`), Node version, and platform.
- For browser-related issues, include the Playwright version and whether you're attached over CDP (`--cdp http://localhost:9222`) or launched fresh.

## PRs

- Match the existing style; we'll point things out if not.
- For non-trivial changes, open an issue first so we can align on shape — the design docs in the portfolio repo are the place to anchor that discussion.
- Tests pass (`pnpm test`). Typecheck clean (`pnpm typecheck`). Build green (`pnpm build`).

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](LICENSE).
