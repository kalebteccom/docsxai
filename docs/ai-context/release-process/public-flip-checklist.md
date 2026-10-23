# Public flip checklist — operational (walk-through on the day)

This is the artifact the owner walks through line-by-line on flip day. The planning-level version (the tracking-issue checklist of what must be true before the flip) lives at `docs/public-flip-checklist.md`. This file is the operational runbook: what to do, in what order, what to verify after each step, and what the rollback path is if anything goes wrong.

## 1. Pre-flip code state — last green build

- [ ] `main` is at the commit you intend to ship. Note the SHA here: `_____`
- [ ] The Woodpecker pipeline on that SHA is green across every step: `build`, `typecheck`, `lint`, `format-check`, `architecture`, `test`, `audit`, `package-contents`, `secret-scan`.
- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm test && pnpm lint && pnpm format:check && node scripts/audit-package-contents.mjs && node scripts/lockfile-lint.mjs` all clean locally on a fresh clone.

## 2. Git scrub — full history, not just HEAD

- [x] **History scrub executed 2026-06-12**: `git filter-repo --invert-paths` removed `docs/validation-prompt-codex.md` (the only blobs in all of history carrying internal `/Users/...` paths or the adopter identifier; verified by a full all-refs scan before and after, zero hits across 231 commits). HEAD tree bit-identical pre/post; main force-pushed; all 15 stale remote branches deleted (origin carries `main` only); local commits re-parented. Pre-scrub backup: `~/docsxai-pre-scrub-backup-20260612.bundle`.
- [ ] **Residual, GitHub-retained PR refs**: 19 `refs/pull/*` survive server-side (not deletable by push) and still reference pre-scrub objects. Before the flip: ask GitHub Support to GC unreachable/PR-ref objects, or delete-and-recreate the private repo (clean slate; nothing external links it yet) and push the scrubbed history.
- [ ] `trufflehog git file://. --results=verified,unknown --no-update` over the full history as the final pre-flip confirmation. Resolve any verified hit.
- [ ] Grep the tracked tree for `/Users/`, `/home/`, internal hostnames, Kalebtec-only references, adopter names.
- [ ] Confirm no `.env*`, no `*.storageState.json`, no `artifacts/`, no `.auth/` in the tracked tree.
- [ ] `.claude/hooks/` scripts read cleanly to a stranger — no internal IDs, no internal paths.

## 3. GitHub settings (still private)

- [ ] Branch protection on `main`: the required status check is the Woodpecker `ci/woodpecker/push/ci` (the merge gate is the green pipeline at the head SHA, see `AGENTS.md`), required PR review, no force-push, linear history, signed commits required.
- [ ] CODEOWNERS protections cover: `.github/`, every `package.json`, every `LICENSE`, `.woodpecker/`.
- [ ] The Woodpecker secret `npm_publish_token` exists, is restricted to exactly the `manual` event, and is the only npm token. It is a stage-only granular token (see `RELEASING.md`).
- [ ] Dependabot security updates enabled; Dependabot version updates per `dependabot.yml`.
- [ ] GitHub Advanced Security: secret scanning push protection ON.

## 4. npm package configuration (per published package)

For each of the 7 published names — the unscoped `docsxai` meta-package (the batteries-included CLI install) plus the 6 published scoped packages on the registered `@docsxai` org, `@docsxai/backend`, `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/plugin-sharepoint`, `@docsxai/skill`, `@docsxai/viewer`:

- [ ] Package exists on npm, and both owners (`kalebtec-studio`, `kalebtec-recovery`) own it.
- [ ] The stage-only token covers the package (scope-level write on `@docsxai` plus `docsxai`).
- [ ] No trusted-publisher binding applies: the release pipeline runs on Woodpecker, not GitHub Actions.
- [ ] No legacy automation tokens on the maintainer account.

> **Repo-only packages.** `@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-gitbook`, `@docsxai/plugin-guru`, `@docsxai/plugin-notion`, and `@docsxai/plugin-starlight` keep `"private": true` and do not publish (documented as repo-only; revisit later). When one flips, remove its `private` flag, add it to the script's package list and to the token's scope in the same change.

## 5. First release — supervised

1. Promote `## Unreleased` in `CHANGELOG.md` → `## [X.Y.Z] - YYYY-MM-DD`.
2. Bump every publishable `packages/*/package.json` to `X.Y.Z` (root and the repo-only packages keep their versions). Verify `pnpm-lock.yaml` is consistent.
3. Commit on a PR: `chore(release): vX.Y.Z`. Squash-merge to `main` (do not force-push to `main`).
4. Pull the merged commit locally: `git pull --ff-only origin main`.
5. Sign and push the tag: `git tag -s vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`. The push starts nothing.
6. In the Woodpecker UI, run the pipeline manually on the tagged commit with `RELEASE_TAG=vX.Y.Z` (`.woodpecker/release.yaml`).
7. Verify the run is on the expected SHA and tag. The `publish` step stages each package.
8. On a machine with 2FA, approve each staged version: `npm stage list <package>`, then `npm stage approve <stage-id> --otp <code>`. Staged versions carry no provenance attestation.
9. From a fresh machine: `npm install @docsxai/engine@X.Y.Z` and confirm `npm view` shows the version on the expected dist-tag.

## 6. Post-publish hardening

- [ ] Create the GitHub Release by hand (`gh release create vX.Y.Z --generate-notes --verify-tag`; the pipeline holds no GitHub token). Attach an SBOM if wanted (see `RELEASING.md`).
- [ ] Verify the published tarballs against `scripts/audit-package-contents.mjs` policy — pull each `.tgz` from the registry and re-audit.

## 7. Website go-live (publish-first ordering: npm publish → site deploy → DNS)

Do not point DNS at a site that documents packages that aren't installable yet — the npm publish (section 5) comes first.

- [ ] Netlify production deploy of `website/` triggered against the tagged commit; build green (`pnpm docs:build` parity locally).
- [ ] DNS + TLS verified: site domain resolves to Netlify, apex/`www` redirect works, certificate valid.
- [ ] `og:image` verified: `https://<site-domain>/og.png` returns the card and a link-preview checker renders it.
- [ ] Favicon set loads: `favicon.svg`, `favicon.ico`, `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png`.
- [ ] `/llms.txt` is served and matches the shipped docs surface.
- [ ] 404 page renders the branded page (not a Netlify default); one deep docs URL spot-checked post-DNS.

## 8. Adopter readiness sanity

- [ ] `docs/security-best-practices-for-adopters.md` reflects the released surface (capabilities, provenance verification command, install posture).
- [ ] `README.md` install snippet uses the correct published name (`@docsxai/engine` for the library, `@docsxai/plugin` for the Claude Code plugin).
- [ ] `CHANGELOG.md` entry for X.Y.Z reads cleanly to a stranger.

## 9. Rollback path

If anything goes wrong after the first publish:

- **Broken publish (wrong files, leak):** `npm deprecate @docsxai/<pkg>@X.Y.Z "broken — use X.Y.(Z+1)"`. Do **not** `npm unpublish` after the 72h grace; the version is permanently consumed either way. Publish the next patch with the fix.
- **Compromise during the window:** Rotate the maintainer's WebAuthn keys. Revoke any active sessions. File a GitHub Security Advisory. Use the breakglass account only as a last resort.
- **Repo flip went out before npm was ready:** Flip the repo back to private. The git history is already public — that can't be undone. Don't panic; finish npm setup and re-flip.

## 10. Communication

- [ ] Launch announcement drafted and reviewed before flip day. Do not draft it under flip-day pressure.
- [ ] Security disclosure channel (`SECURITY.md` contact) is monitored — owner is available for the first 48h.
- [ ] First-week metrics to watch: install count, GitHub stars, issue volume, first dependent packages. Note the baseline here: `_____`.
