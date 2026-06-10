# Releasing docsxai

This repo's GitHub identity is `kalebteccom/automated-site-documentation-bot` (the codename). The npm package name is `docsxai` (the product name). The two are independent on purpose: npm names are global and we want the clean product name on the registry; we keep the codename on GitHub so the implementation history isn't disturbed.

| Surface | Name |
|---|---|
| GitHub repo | `kalebteccom/automated-site-documentation-bot` |
| CLI codename | `site-docs` |
| Internal codename | `automated-site-documentation-bot` |
| npm package | `docsxai` |
| Product name | docsxai |

The current published artifact is a **pre-release stub** (`0.0.1-stub.0`) whose only purpose is to reserve the `docsxai` name on npm and prove the OIDC trusted-publishing path end-to-end. Importing it throws. The real package ships at `v1.0`.

## Trust model

Releases use **npm Trusted Publishing via GitHub OIDC** — no `NPM_TOKEN` exists in this repo, in CI, or on a maintainer machine. A token that doesn't exist cannot leak.

- Tag-triggered only (`v*.*.*` on push). The workflow is unreachable from `pull_request*` events; PR-derived code can never request an OIDC token.
- `permissions: {}` at workflow level, narrowed per job. The `publish` job is the only place `id-token: write` exists.
- `environment: release` gates the publish behind a required-reviewer manual approval (configured in GitHub once the repo flips public — pre-flip TODO below).
- npm-side: the `docsxai` package will be bound to this exact repo + workflow filename + environment name. Anything else trying to publish under our identity fails closed.
- `--provenance` always — Sigstore attestation proves the artifact came from this workflow on this tagged commit.

## How to cut a release

1. Bump `version` in the top-level `package.json` (the stub uses `0.0.1-stub.0`, `0.0.1-stub.1`, etc. while we're claiming the name).
2. Commit with `chore(release): vX.Y.Z`.
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `release` workflow fires on tag push, waits for environment approval, then publishes with provenance.

That's the whole release flow for the stub. The full v1.0 flow will add build + reproducibility + SBOM jobs ahead of `publish` — out of scope for this phase.

## Workflow behavior

`.github/workflows/release.yml`:

- Trigger: `push` of a `v*.*.*` tag only.
- One job (`publish`) running on `environment: release` with `id-token: write` + `contents: read`.
- Checks out with `persist-credentials: false` (ArtiPACKED mitigation).
- Sets up Node 20 against the npmjs.org registry, with no package-manager cache (cache-poisoning mitigation per universal-baseline rule 26).
- Upgrades npm to `>= 11.5.1` (required for trusted publishing).
- Runs `npm publish --provenance --access public`.

No build step — the stub is `index.js` + `README.md`, listed verbatim in the `files` allowlist.

## Pre-flip TODO

These items are blocked on either flipping the repo public or on registering the trust binding on npm. **Do not skip — the workflow will fail closed without them.**

- [ ] **Configure GitHub `release` environment** with required reviewers. Requires the repo to be public OR Team/Enterprise plan (environments aren't available on free private repos). Restrict deployments to `main` and `release/*` branches.
- [ ] **Register npm Trusted Publisher binding** for the `docsxai` package on npmjs.com → `docsxai` → Settings → Trusted Publishers. Bind to:
  - Repository: `kalebteccom/automated-site-documentation-bot`
  - Workflow filename: `release.yml`
  - Environment name: `release`
- [ ] **Set `"Require 2FA and disallow tokens"`** on the `docsxai` package on npm after the first successful OIDC publish (universal-baseline rule 9).
- [ ] **Verify named-human owners ≥ 2** on the package and that both have phishing-resistant WebAuthn credentials (universal-baseline rules 1 + 7).

The stub-publish path is intentionally narrow. When v1.0 lands, the full release.yml pattern from `browxai` (build matrix + reproducibility diff + SBOM + plugin publish) lifts wholesale.
