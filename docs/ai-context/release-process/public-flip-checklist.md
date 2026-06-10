# Public flip checklist — operational (walk-through on the day)

This is the artifact the owner walks through line-by-line on flip day. The planning-level version (which items existed across the Phase D series, and what the high-level pre-flight was) lives at `docs/public-flip-checklist.md`. This file is the operational runbook: what to do, in what order, what to verify after each step, and what the rollback path is if anything goes wrong.

## 1. Pre-flip code state — last green build

- [ ] `main` is at the commit you intend to ship. Note the SHA here: `_____`
- [ ] CI on that SHA is green across every required check: `lint`, `format-check`, `audit`, `secret-scan`, `package-contents`, `build` matrix.
- [ ] `zizmor --persona=auditor --min-severity=high .github/workflows/` reports `No findings to report.` (the in-CI zizmor job stays advisory because of the upstream `zizmorcore/zizmor-action` infra issue — see the TODO in `quality.yml`).
- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm test && pnpm lint && pnpm format:check && node scripts/audit-package-contents.mjs && node scripts/lockfile-lint.mjs` all clean locally on a fresh clone.

## 2. Git scrub — full history, not just HEAD

- [ ] `trufflehog git file://. --results=verified,unknown --no-update` over the full history, including any branches that will outlive the flip. Resolve every verified hit (BFG / `git filter-repo` if needed; force-push to a fresh branch and re-tag).
- [ ] Grep the tracked tree for `/Users/`, `/home/`, internal hostnames, Kalebtec-only references, adopter names.
- [ ] Confirm no `.env*`, no `*.storageState.json`, no `artifacts/`, no `.auth/` in the tracked tree.
- [ ] `.claude/hooks/` scripts read cleanly to a stranger — no internal IDs, no internal paths.

## 3. GitHub settings (still private)

- [ ] Branch protection on `main`: required CI checks (every `quality.yml` job + `ci.yml` build matrix), required PR review, no force-push, linear history, signed commits required.
- [ ] CODEOWNERS protections cover: `.github/`, every `package.json`, every `LICENSE`, `release.yml`.
- [ ] Repository "Secrets and variables → Actions" contains only what `release.yml` needs (none, if OIDC is fully set up). No long-lived npm tokens.
- [ ] Repository "Environments → release": required reviewer is the maintainer's account; deployment branch rule restricted to `main` and tags `v*`.
- [ ] Dependabot security updates enabled; Dependabot version updates per `dependabot.yml`.
- [ ] GitHub Advanced Security: secret scanning push protection ON.

## 4. npm trusted-publisher configuration (per published package)

For each of the 5 scoped packages — `@kalebtec/docsxai-backend`, `@kalebtec/docsxai-engine`, `@kalebtec/docsxai-plugin`, `@kalebtec/docsxai-skill`, `@kalebtec/docsxai-viewer` — and, if D5 has landed the stub-publish path, the unscoped `docsxai`:

- [ ] Package exists on npm (publish a pre-release `0.0.0-trusted-publisher-setup` if needed, then deprecate).
- [ ] Trusted publisher entry: repository `kalebteccom/docsxai`, workflow `.github/workflows/release.yml`, environment `release`.
- [ ] "Require 2FA and disallow tokens" — set after the first successful OIDC publish, not before (you need at least one OIDC publish to verify the flow works first).
- [ ] No legacy automation tokens on the maintainer account.

> **Precondition flag — `docsxai` unscoped.** The unscoped name depends on D5's stub-publish path rework. If D5 hasn't landed by flip day, ship the 5 scoped packages only and reserve the unscoped name with a deprecated stub.

## 5. First OIDC publish — supervised

1. Promote `## Unreleased` in `CHANGELOG.md` → `## [1.0.0] - YYYY-MM-DD`.
2. Bump root + every `packages/*/package.json` to `1.0.0`. Verify `pnpm-lock.yaml` is consistent.
3. Commit on a PR: `chore(release): v1.0.0`. Squash-merge to `main` (do not force-push to `main`).
4. Pull the merged commit locally: `git pull --ff-only origin main`.
5. Sign and push the tag: `git tag -s v1.0.0 -m "v1.0.0" && git push origin v1.0.0`.
6. Watch the Actions tab. The `release.yml` job will pause on the `release` environment gate.
7. Verify the workflow run is on the expected SHA and tag. Approve the gate.
8. Watch each package publish. Each step should emit `npm notice Publishing to https://registry.npmjs.org/...` and the provenance attestation.
9. From a fresh machine: `npm install @kalebtec/docsxai-engine@1.0.0 && npm audit signatures`. Expect `5 packages have audited signatures` (or however many depend on docsxai packages).

## 6. Post-publish hardening

- [ ] On each published npm package: "Require 2FA and disallow tokens" → ON.
- [ ] Add the v1.0.0 release notes to GitHub Releases (the workflow creates the entry; flesh out the body).
- [ ] Verify SBOM upload on the GitHub Release.
- [ ] Verify the published tarballs against `scripts/audit-package-contents.mjs` policy — pull each `.tgz` from the registry and re-audit.

## 7. Adopter readiness sanity

- [ ] `docs/security-best-practices-for-adopters.md` reflects the v1.0 surface (capabilities, provenance verification command, install posture).
- [ ] `README.md` install snippet uses the correct published name (`@kalebtec/docsxai-engine` for the library, `@kalebtec/docsxai-plugin` for the Claude Code plugin).
- [ ] `CHANGELOG.md` entry for 1.0.0 reads cleanly to a stranger.

## 8. Rollback path

If anything goes wrong after the first publish:

- **Broken publish (wrong files, leak):** `npm deprecate @kalebtec/docsxai-<pkg>@1.0.0 "broken — use 1.0.1"`. Do **not** `npm unpublish` after the 72h grace; the version is permanently consumed either way. Publish 1.0.1 with the fix.
- **Compromise during the window:** Rotate the maintainer's WebAuthn keys. Revoke any active sessions. File a GitHub Security Advisory. Use the breakglass account only as a last resort.
- **Repo flip went out before npm was ready:** Flip the repo back to private. The git history is already public — that can't be undone. Don't panic; finish npm setup and re-flip.

## 9. Communication

- [ ] Launch announcement drafted and reviewed before flip day. Do not draft it under flip-day pressure.
- [ ] Security disclosure channel (`SECURITY.md` contact) is monitored — owner is available for the first 48h.
- [ ] First-week metrics to watch: install count, GitHub stars, issue volume, first dependent packages. Note the baseline here: `_____`.
