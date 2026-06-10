# Releasing docsxai

This repo's GitHub identity is `kalebteccom/docsxai` (renamed from `kalebteccom/automated-site-documentation-bot`; the codename `site-docs` still lives on inside the source tree — CLI binary, slash commands, workspace config file). The npm packages are scoped under `@kalebtec/docsxai-*` (plus the root `docsxai` package that holds the trusted-publishing claim). The two are independent on purpose: npm names are global and we want the clean product name on the registry; we keep the codename inside the implementation so the history isn't disturbed.

| Surface           | Name                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub repo       | `kalebteccom/docsxai`                                                                                                                      |
| CLI codename      | `site-docs` (the engine bin)                                                                                                               |
| Internal codename | `site-docs` / `automated-site-documentation-bot`                                                                                           |
| npm packages      | `@kalebtec/docsxai-engine`, `@kalebtec/docsxai-plugin`, `@kalebtec/docsxai-backend`, `@kalebtec/docsxai-skill`, `@kalebtec/docsxai-viewer` |
| Product name      | docsxai                                                                                                                                    |

> **Status: prepared, deferred.** Everything below is _ready_. The actual public release is deferred to **≥ Phase 3** by owner decision (2026-05-19) — the repo stays **private** and unpublished until the full project (through Phase 3) is done. This file is the mechanical checklist for _when_ that decision is taken; nothing here is to be executed before then.

The repo is intentionally in a "one-flip-from-public" state: Apache-2.0 in place, READMEs/CONTRIBUTING/CHANGELOG written, npm metadata (`repository`/`homepage`/`bugs`/`keywords`) on every package, git history scrubbed of client identifiers (2026-05-15), versions set to `0.1.0`, and every workspace `package.json` carries `"private": true` so an accidental `npm publish` is impossible until deliberately flipped.

## Why deferred

Owner decision (2026-05-19): hold the public release until the whole project is done (at least Phase 3). docsxai is Apache-2.0-from-day-one per its spec — there's no licensing gate — but going public commits to a stable public API + semver obligations + external-contributor surface. The owner prefers to land that once, after Phase 3, rather than maintain a public API through Phase-2 churn (GitHub App, engine-side Confluence push, standalone MCP server, additional feature areas).

## Trust model

Releases use **npm Trusted Publishing via GitHub OIDC** — no `NPM_TOKEN` exists in this repo, in CI, or on a maintainer machine. A token that doesn't exist cannot leak.

- Tag-triggered only (`v*.*.*` on push). The workflow is unreachable from `pull_request*` events; PR-derived code can never request an OIDC token.
- `permissions: {}` at workflow level, narrowed per job. The `publish` job is the only place `id-token: write` exists.
- `environment: release` gates the publish behind a required-reviewer manual approval (configured in GitHub once the repo flips public — pre-flip TODO below).
- npm-side: the `docsxai` package is bound to this exact repo + workflow filename + environment name. Anything else trying to publish under our identity fails closed.
- `--provenance` always — Sigstore attestation proves the artifact came from this workflow on this tagged commit.

## The flip (Phase-3, in order)

Each step is mechanical because the prep is done:

1. **Pre-flight.** `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm -r build` — all green. `git log -p | grep -iE "<client>|<product>|<asset>"` — zero (the 2026-05-15 scrub holds; re-audit any docs added since).
2. **Un-private the publishable packages.** Set `"private": false` in `packages/{engine,plugin,backend,viewer,skill}/package.json` (keep root `private: true` — it's the monorepo wrapper, never published from the workspace tree). Decide which packages are actually published vs internal-only.
3. **Finalise the CHANGELOG.** Move the `[0.1.0] — UNRELEASED` heading to `[0.1.0] — <date>`; add the compare link.
4. **Tag.** `git tag -a v0.1.0 -m "docsxai 0.1.0"` then `git push origin v0.1.0`.
5. **Publish.** `pnpm -r publish --access public` (or per-package, in dependency order: engine → viewer → backend → skill → plugin). Verify each on npm.
6. **Repo visibility.** Flip the GitHub repo `kalebteccom/docsxai` to public. Confirm the README renders, the LICENSE is detected, CONTRIBUTING is linked.
7. **Announce / portfolio.** Update the portfolio `roadmap.md` Phase-3 entry + decisions log; flip the portfolio README row.

## Stub release (name-claim) flow

The pre-Phase-3 stub publish path exists only to reserve the `docsxai` name on npm and prove the OIDC trusted-publishing path end-to-end. Importing the stub throws. The real package ships at `v1.0`.

1. Bump `version` in the top-level `package.json` (the stub uses `0.0.1-stub.0`, `0.0.1-stub.1`, etc. while we're claiming the name).
2. Commit with `chore(release): vX.Y.Z`.
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `release` workflow fires on tag push, waits for environment approval, then publishes with provenance.

> **D1 note (2026-06-10):** the stub `index.js` and the root `package.json`'s `main`/`files` allowlist were dropped during the `@kalebtec/site-docs-* → @kalebtec/docsxai-*` rename, and the root is now `private: true`. Restoring the stub-publish path (or replacing it with the per-package publish flow) is a Phase D2+ task; `release.yml` is currently dormant until then.

## Workflow behavior

`.github/workflows/release.yml`:

- Trigger: `push` of a `v*.*.*` tag only.
- One job (`publish`) running on `environment: release` with `id-token: write` + `contents: read`.
- Checks out with `persist-credentials: false` (ArtiPACKED mitigation).
- Sets up Node 20 against the npmjs.org registry, with no package-manager cache (cache-poisoning mitigation per universal-baseline rule 26).
- Upgrades npm to `>= 11.5.1` (required for trusted publishing).
- Runs `npm publish --provenance --access public`.

## Pre-flip TODO

These items are blocked on either flipping the repo public or on registering the trust binding on npm. **Do not skip — the workflow will fail closed without them.**

- [ ] **Configure GitHub `release` environment** with required reviewers. Requires the repo to be public OR Team/Enterprise plan (environments aren't available on free private repos). Restrict deployments to `main` and `release/*` branches.
- [ ] **Register npm Trusted Publisher binding** for the `docsxai` package on npmjs.com → `docsxai` → Settings → Trusted Publishers. Bind to:
  - Repository: `kalebteccom/docsxai`
  - Workflow filename: `release.yml`
  - Environment name: `release`
- [ ] **Set `"Require 2FA and disallow tokens"`** on the `docsxai` package on npm after the first successful OIDC publish (universal-baseline rule 9).
- [ ] **Verify named-human owners ≥ 2** on the package and that both have phishing-resistant WebAuthn credentials (universal-baseline rules 1 + 7).

The stub-publish path is intentionally narrow. When v1.0 lands, the full release.yml pattern from `browxai` (build matrix + reproducibility diff + SBOM + plugin publish) lifts wholesale.

## Do NOT, before the Phase-3 decision

- Do not `npm publish` (the `private:true` flags block it anyway — leave them).
- Do not flip the GitHub repo to public.
- Do not cut the `v0.1.0` git tag (a tag implies a release; we're prepared, not released).
- Do not remove the `"private": true` flags as "cleanup" — they are the deliberate safety.

Anything that needs to happen _before_ the flip (more docs, API stabilisation, security review) gets done here in the private repo first.
