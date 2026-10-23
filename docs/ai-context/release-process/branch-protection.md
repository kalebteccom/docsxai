# Branch protection

The repo is public. The `main` ruleset requires the Woodpecker status `ci/woodpecker/push/ci` and blocks branch deletion and force push. Releases run in `.woodpecker/release.yaml` on the `manual` event only; no GitHub Actions workflow remains.

## What's already in place

- `main` is the integration branch. PRs land via `gh pr create` + review.
- Commits on `main` are signed (server-side requirement on the upstream repo). Local signing config must match.
- A `v*.*.*` tag push starts nothing. The release pipeline runs only when the owner (or an agent the owner authorises) starts it manually with `RELEASE_TAG`, and the owner approves each staged npm version with 2FA.

## What lands at the public flip

- The full `main`-target ruleset: linear history, the required status check `ci/woodpecker/push/ci`, required-PR-with-CODEOWNERS-review, no admin bypass.
- A path-scoped ruleset for `.github/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `LICENSE`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `tsconfig.base.json`, `eslint.config.js`, `.githooks/**` — defense-in-depth versus a PR that silently amends CODEOWNERS.

## Agent rules

From `AGENTS.md`: never force-push to `main`; never run `gh pr merge --admin`; never push without local verify. The Claude / Codex hooks enforce these on agent-driven `git push` invocations; the server-side ruleset enforces them too.

## Related

- [`semver-clock.md`](semver-clock.md)
- [`../../../RELEASING.md`](../../../RELEASING.md)
- [`../../../SECURITY.md`](../../../SECURITY.md)
