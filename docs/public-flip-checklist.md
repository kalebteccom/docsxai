# Public flip checklist (v1.0)

Planning-level checklist for the docsxai v1.0 public flip. Open a tracking issue for each item; close as you complete. The operational, walk-through-on-the-day version lives at `docs/ai-context/release-process/public-flip-checklist.md`.

## Pre-flight: governance + multi-harness substrate merged

- [ ] `AGENTS.md`, `CLAUDE.md` pointer, `.cursor/`, `.codex/`, `.agents/`
- [ ] `docs/ai-context/` subtree complete
- [ ] `SECURITY.md`, `CODE_OF_CONDUCT.md`, `MAINTAINERS.md`, `CONTRIBUTING.md`, `RELEASING.md`
- [ ] `docs/security-best-practices-for-adopters.md`
- [ ] Per-package `LICENSE` files + `"author"` fields in each `package.json`
- [ ] `THIRD_PARTY_NOTICES.md` regenerated from current `pnpm-lock.yaml`
- [ ] Prettier, ESLint, `.githooks/`, `quality.yml`, `release.yml`, CODEOWNERS, Dependabot config

## Pre-flight: quality-gate convergence merged

- [ ] `pnpm lint` clean (0 errors / 0 warnings) — gate is now load-bearing in `quality.yml`
- [ ] `pnpm format:check` clean — gate is now load-bearing in `quality.yml`
- [ ] Per-package `tsconfig.build.json` excludes tests and disables sourceMap / declarationMap — `node scripts/audit-package-contents.mjs` is clean
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit:prod` all green
- [ ] `zizmor --persona=auditor --min-severity=high .github/workflows/` reports 0 findings

## Pre-flight: owner-driven setup (out-of-repo)

- [ ] WebAuthn enrolled on the maintainer's npm account
- [ ] Breakglass npm account created with separate keys + email
- [x] `@docsxai` org scope claimed on npm (registered) - enforce "Require 2FA" on it before the first publish
- [ ] `docsxai` unscoped package name claimed (precondition: D5 stub-publish path rework decides whether the unscoped entrypoint ships as a thin shim over `@docsxai/engine` or as a separate published package)
- [ ] Typosquat package names pre-claimed and deprecated (`doxai`, `docsai`, `docsx-ai`, etc.)
- [ ] npm trusted-publisher configuration set per package (repo + workflow + `release` environment binding) for all 8 scoped packages on the registered `@docsxai` org: `@docsxai/{backend,engine,plugin,skill,viewer,mcp,plugin-confluence,plugin-starlight}` plus `docsxai` unscoped if D5 lands
- [ ] GitHub `release` environment configured (required reviewer, branch restriction)
- [ ] Domain renewal calendar reminders set

## Pre-flight: final sanity sweeps

- [ ] Run a secret scan on the full git history; resolve any findings (`trufflehog git file://. --results=verified,unknown --no-update`)
- [ ] Grep the tracked tree for personal paths, adopter-internal hostnames, Kalebtec-internal references
- [ ] Read `CHANGELOG.md` end-to-end as a stranger would; remove anything stale or internal
- [ ] Verify `.claude/hooks/` scripts have no internal references

## Flip-day ordered actions

1. Promote `## Unreleased` in `CHANGELOG.md` to `## [1.0.0] - YYYY-MM-DD`.
2. Bump root `package.json` version to `1.0.0` and propagate to each `packages/*/package.json`.
3. Commit `chore(release): v1.0.0`.
4. Sign and push tag: `git tag -s v1.0.0 && git push origin main --tags`.
5. Watch the GitHub Actions run; approve the `release` environment gate when prompted.
6. `release.yml` publishes via OIDC + uploads SBOM + creates the GitHub Release.
7. Verify `npm install @docsxai/engine@1.0.0` from a clean machine. Run `npm audit signatures`.
8. After the first OIDC publish succeeds, enable "Require 2FA and disallow tokens" on every published package on the npm side.
9. In GitHub repo settings: branch protection on `main` with required CI, required reviews, no force-push, signed commits. Verify CODEOWNERS protections on `.github/`, manifests, license, release workflow.
10. Flip repository visibility to public.
11. Post the launch announcement.

## Post-flip monitoring (first 30 days)

- Watch the security disclosure channel.
- Watch for unusual install patterns.
- Be ready for the first community PR; respond within 7 days.
- Track first-month metrics: install count, GitHub stars, issue volume, first dependent packages.
