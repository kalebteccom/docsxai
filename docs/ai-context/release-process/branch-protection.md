# Branch protection — stub

Placeholder. The richer required-ruleset configuration matures alongside the public-flip checklist. Today the repo is private; `release.yml` triggers on `v*.*.*` tag pushes, and the `release` environment approval that gates the publish jobs becomes enforceable at the public flip (environment protection is unavailable on private free-plan repos). Full branch-ruleset configuration goes into effect at the flip.

## What's already in place

- `main` is the integration branch. PRs land via `gh pr create` + review.
- Commits on `main` are signed (server-side requirement on the upstream repo). Local signing config must match.
- `release.yml` runs on `v*.*.*` tag pushes; tags are maintainer-only today (private repo, single committer), and the publish jobs additionally sit behind the `release` environment once the flip makes that enforceable.

## What lands at the public flip

- The full `main`-target ruleset: linear history, required status checks (`ci / build (20)`, `ci / build (22)`, `quality / lint`, `quality / audit`, `quality / secret-scan`, `CodeQL` once enabled), required-PR-with-CODEOWNERS-review, no admin bypass.
- A path-scoped ruleset for `.github/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `LICENSE`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `tsconfig.base.json`, `eslint.config.js`, `.githooks/**` — defense-in-depth versus a PR that silently amends CODEOWNERS.
- A GitHub Environment `release` with required reviewers and `main`-only deployment branches; OIDC trusted-publisher binding per npm package.
- Org-level Actions policy: allowlisted actions, SHA-pinned, read-only default `GITHUB_TOKEN`.

## Until the public flip

The advisory rule from `AGENTS.md`: never force-push to `main`; never run `gh pr merge --admin`; never push without local verify. The Claude / Codex hooks enforce these on agent-driven `git push` invocations; the server-side ruleset arrives at the public flip.

## Related

- [`semver-clock.md`](semver-clock.md)
- [`../../../RELEASING.md`](../../../RELEASING.md)
- [`../../../SECURITY.md`](../../../SECURITY.md)
