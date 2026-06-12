# Releasing docsxai

One name everywhere: the GitHub repo is `kalebteccom/docsxai` (renamed from `kalebteccom/automated-site-documentation-bot`), the CLI is `docsxai`, and the npm packages live on the registered `@docsxai` org (plus the bare `docsxai` package that holds the trusted-publishing claim). The old `site-docs` codename surfaces were retired in a pre-publish clean break (owner decision, 2026-06-12) — nothing had shipped, so there are no compatibility aliases.

| Surface      | Name                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub repo  | `kalebteccom/docsxai`                                                                                            |
| CLI          | `docsxai` (the engine bin)                                                                                       |
| npm packages | published at the flip: `docsxai` (stub), `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`. Repo-only (`private: true`, revisitable post-flip): `@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-starlight` |
| Product name | docsxai                                                                                                          |

> **Status: prepared, deferred.** Everything below is _ready_. The actual public release is owner-deferred (2026-05-19) — the repo stays **private** and unpublished until the project's stable-surface work is done. This file is the mechanical checklist for _when_ that decision is taken; nothing here is to be executed before then.

The repo is intentionally in a "one-flip-from-public" state: Apache-2.0 in place, READMEs/CONTRIBUTING/CHANGELOG written, npm metadata (`repository`/`homepage`/`bugs`/`keywords`) on every package, git history scrubbed of client identifiers (2026-05-15; a fresh full-history scrub re-runs as a pre-flip gate). The flip version is **v1.0.0**. Six packages publish at the flip — the bare `docsxai` stub plus `@docsxai/{engine,plugin,backend,skill,viewer}`; `@docsxai/{mcp,plugin-confluence,plugin-starlight}` and `@docsxai/website` keep `"private": true` and stay repo-only (revisitable after the flip). Publishing only happens through the OIDC workflow — no local `npm publish` path exists.

## Why deferred

Owner decision (2026-05-19): hold the public release until the project's stable-surface work is done. docsxai is Apache-2.0-from-day-one per its spec — there's no licensing gate — but going public commits to a stable public API + semver obligations + external-contributor surface. The owner prefers to land that once, after the planned feature areas (GitHub App, engine-side Confluence push, standalone MCP server, additional feature areas) settle, rather than maintain a public API through that churn.

## Trust model

Releases use **npm Trusted Publishing via GitHub OIDC** — no `NPM_TOKEN` exists in this repo, in CI, or on a maintainer machine. A token that doesn't exist cannot leak.

- Tag-triggered only (`v*.*.*` on push). The workflow is unreachable from `pull_request*` events; PR-derived code can never request an OIDC token.
- `permissions: {}` at workflow level, narrowed per job. The `publish` job is the only place `id-token: write` exists.
- `environment: release` gates the publish behind a required-reviewer manual approval (configured in GitHub once the repo flips public — pre-flip TODO below).
- npm-side: the `docsxai` package is bound to this exact repo + workflow filename + environment name. Anything else trying to publish under our identity fails closed.
- `--provenance` always — Sigstore attestation proves the artifact came from this workflow on this tagged commit.

## The flip (in order)

Each step is mechanical because the prep is done:

1. **Pre-flight.** `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm -r build` — all green. Full-history secret/identifier scan clean (the 2026-05-15 scrub holds; re-audit any docs added since).
2. **Verify the publish set.** The six publishable manifests (`packages/docsxai` + `packages/{engine,plugin,backend,skill,viewer}`) carry no `"private"` flag; `@docsxai/{mcp,plugin-confluence,plugin-starlight}`, `@docsxai/website`, and the workspace root keep `"private": true`.
3. **Finalise the CHANGELOG.** Promote `## Unreleased` to `## [1.0.0] - <date>`; add the compare link.
4. **Version + tag.** Bump the publishable packages to `1.0.0`, commit `chore(release): v1.0.0`, then `git tag -s v1.0.0 -m "v1.0.0"` and `git push origin v1.0.0`.
5. **Publish.** The tag push triggers `release.yml`; approve the `release` environment gate. The workflow publishes the six packages with provenance, attaches the SBOM, and creates the GitHub Release. Verify each package on npm — never publish locally.
6. **Repo visibility.** Flip the GitHub repo `kalebteccom/docsxai` to public. Confirm the README renders, the LICENSE is detected, CONTRIBUTING is linked.
7. **Site + announce.** Deploy the docs site (`website/` via Netlify) and verify DNS, then announce. The operational ordering (publish → site deploy → DNS checks) lives in `docs/ai-context/release-process/public-flip-checklist.md`.

## Stub release (name-claim) flow

The pre-v1.0 stub publish path exists only to reserve the `docsxai` name on npm and prove the OIDC trusted-publishing path end-to-end. Importing the stub throws. The real package ships at `v1.0`.

1. Bump `version` in `packages/docsxai/package.json` (the stub uses `0.0.1-stub.0`, `0.0.1-stub.1`, etc. while we're claiming the name).
2. Commit with `chore(release): vX.Y.Z`.
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `release` workflow fires on tag push, waits for environment approval, then publishes with provenance.

> **Note:** the stub lives at `packages/docsxai/` (a throwing `index.js` + README; the workspace root stays `private: true`). `release.yml` publishes it via the `publish-docsxai` job alongside the scoped packages.

## Workflow behavior

`.github/workflows/release.yml`:

- Trigger: `push` of a `v*.*.*` tag only.
- A `build` job (Node 20 + 22 matrix, `contents: read`) gates the publish jobs: typecheck + build + test on the tagged commit.
- Two publish jobs (`publish-docsxai` for the stub, `publish-scoped` for `@docsxai/{engine,plugin,backend,skill,viewer}`) on `environment: release` with `id-token: write` + `contents: read`. The scoped filter explicitly excludes the repo-only packages (`@docsxai/{mcp,plugin-confluence,plugin-starlight,website}`), matching their `"private": true` flags.
- A `github-release` job (`contents: write`) generates a CycloneDX SBOM and creates the GitHub Release for the tag with generated notes, SBOM attached.
- Every job checks out with `persist-credentials: false` (ArtiPACKED mitigation).
- Sets up Node against the npmjs.org registry, with no package-manager cache (cache-poisoning mitigation per universal-baseline rule 26).
- Upgrades npm to `>= 11.5.1` (required for trusted publishing).
- Publishes with `--provenance --access public`.

## Pre-flip TODO

These items are blocked on either flipping the repo public or on registering the trust binding on npm. **Do not skip — the workflow will fail closed without them.**

- [ ] **Configure GitHub `release` environment** with required reviewers. Requires the repo to be public OR Team/Enterprise plan (environments aren't available on free private repos). Restrict deployments to `main` and `release/*` branches.
- [ ] **Register npm Trusted Publisher bindings** — one per published name, 6 total: the bare `docsxai` package plus the 5 scoped packages under the `@docsxai` org (org registered 2026-06-12): `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`. (`@docsxai/{mcp,plugin-confluence,plugin-starlight}` stay repo-only and need no binding until they flip.) On npmjs.com → package → Settings → Trusted Publishers, bind each to:
  - Repository: `kalebteccom/docsxai`
  - Workflow filename: `release.yml`
  - Environment name: `release`
- [ ] **Set `"Require 2FA and disallow tokens"`** on every published package after the first successful OIDC publish (universal-baseline rule 9).
- [ ] **Verify named-human owners ≥ 2** on the package and that both have phishing-resistant WebAuthn credentials (universal-baseline rules 1 + 7).

The v1.0 pipeline already carries the build matrix, SBOM emission, and the GitHub Release step. A reproducibility diff between two independent builds of the same tag remains designed-in but unwired — revisit after the flip.

## Do NOT, before the public-flip decision

- Do not `npm publish` — locally, ever. Publishing is OIDC-only via `release.yml`.
- Do not flip the GitHub repo to public.
- Do not cut the `v1.0.0` git tag (a tag triggers the release workflow; we're prepared, not released).
- Do not remove the `"private": true` flags on `@docsxai/{mcp,plugin-confluence,plugin-starlight}`, `@docsxai/website`, or the workspace root as "cleanup" — they are the deliberate publish boundary.

Anything that needs to happen _before_ the flip (more docs, API stabilisation, security review) gets done here in the private repo first.
