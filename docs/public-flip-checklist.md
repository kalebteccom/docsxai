# Public flip checklist

Planning-level checklist for the docsxai public flip. The repo is public and `0.2.0` is on npm (2026-06-26); unchecked items below were not verified from the repo and need an owner pass. Open a tracking issue for each item; close as you complete. The operational, walk-through-on-the-day version lives at `docs/ai-context/release-process/public-flip-checklist.md`.

## Pre-flight: governance + multi-harness substrate merged

- [ ] `AGENTS.md`, `CLAUDE.md` pointer, `.cursor/`, `.codex/`, `.agents/`
- [ ] `docs/ai-context/` subtree complete
- [ ] `SECURITY.md`, `CODE_OF_CONDUCT.md`, `MAINTAINERS.md`, `CONTRIBUTING.md`, `RELEASING.md`
- [ ] `docs/security-best-practices-for-adopters.md`
- [ ] Per-package `LICENSE` files + `"author"` fields in each `package.json`
- [ ] `THIRD_PARTY_NOTICES.md` regenerated from current `pnpm-lock.yaml`
- [ ] Prettier, ESLint, `.githooks/`, `.woodpecker/ci.yaml`, `.woodpecker/release.yaml`, CODEOWNERS, Dependabot config

## Pre-flight: quality-gate convergence merged

- [ ] `pnpm lint` clean (0 errors / 0 warnings); the gate is load-bearing in `.woodpecker/ci.yaml`
- [ ] `pnpm format:check` clean; the gate is load-bearing in `.woodpecker/ci.yaml`
- [ ] Per-package `tsconfig.build.json` excludes tests and disables sourceMap / declarationMap — `node scripts/audit-package-contents.mjs` is clean
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit:prod` all green

## Pre-flight: owner-driven setup (out-of-repo)

- [ ] WebAuthn enrolled on the maintainer's npm account
- [ ] Breakglass npm account created with separate keys + email
- [x] `@docsxai` org scope claimed on npm (registered) - enforce "Require 2FA" on it before the first publish
- [x] `docsxai` unscoped package name claimed — ships as the real batteries-included meta-package from `packages/docsxai/` (bin wraps `@docsxai/engine`'s CLI in-process; depends on `@docsxai/viewer`), published by `.woodpecker/release.yaml` alongside the scoped packages
- [ ] Typosquat package names pre-claimed and deprecated (`doxai`, `docsai`, `docsx-ai`, etc.)
- [ ] npm stage-only granular token created and the Woodpecker secret `npm_publish_token` set (events restricted to `manual`), covering the 7 published names: `docsxai` unscoped plus the 6 published scoped packages on the registered `@docsxai` org, `@docsxai/{backend,engine,plugin,plugin-sharepoint,skill,viewer}`. `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-starlight}` stay `private: true` / repo-only (revisit later). No trusted-publisher bindings apply on Woodpecker
- [ ] Domain renewal calendar reminders set

## Pre-flight: final sanity sweeps

- [ ] Run a secret scan on the full git history; resolve any findings (`trufflehog git file://. --results=verified,unknown --no-update`)
- [ ] Grep the tracked tree for personal paths, adopter-internal hostnames, Kalebtec-internal references
- [ ] Read `CHANGELOG.md` end-to-end as a stranger would; remove anything stale or internal
- [ ] Verify `.claude/hooks/` scripts have no internal references

## Flip-day ordered actions

1. Promote `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`.
2. Bump each publishable `packages/*/package.json` to `X.Y.Z` (the workspace root and the repo-only packages stay as they are).
3. Commit `chore(release): vX.Y.Z`.
4. Sign and push tag: `git tag -s vX.Y.Z && git push origin vX.Y.Z`.
5. In the Woodpecker UI, run `.woodpecker/release.yaml` manually on the tagged commit with `RELEASE_TAG=vX.Y.Z`. It stages the 7 packages with no provenance.
6. Approve each staged version on npm with 2FA (`npm stage approve`), then create the GitHub Release by hand (`gh release create`).
7. Verify `npm install @docsxai/engine@X.Y.Z` from a clean machine.
8. In GitHub repo settings: branch protection on `main` with the Woodpecker status `ci/woodpecker/push/ci` required, required reviews, no force-push, signed commits. Verify CODEOWNERS protections on `.github/`, manifests, license, `.woodpecker/`.
9. Flip repository visibility to public (done: the repo is public).
10. Website go-live (publish-first ordering — npm packages above, then the site, then DNS):
    1. Trigger the Netlify production deploy of `website/` against the tagged commit; confirm the build is green.
    2. Verify DNS + TLS for the site domain resolve to Netlify and the apex/`www` redirect works.
    3. Verify `og.png` renders in a link-preview checker and the favicon set loads (`favicon.svg`, `favicon.ico`, `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png`).
    4. Verify `/llms.txt` is served and its content matches the shipped docs surface.
    5. Spot-check the 404 page and one deep docs URL post-DNS.
11. Post the launch announcement.

## Post-flip monitoring (first 30 days)

- Watch the security disclosure channel.
- Watch for unusual install patterns.
- Be ready for the first community PR; respond within 7 days.
- Track first-month metrics: install count, GitHub stars, issue volume, first dependent packages.
