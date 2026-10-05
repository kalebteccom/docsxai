# Releasing docsxai

One name everywhere: the GitHub repo is `kalebteccom/docsxai` (renamed from `kalebteccom/automated-site-documentation-bot`), the CLI is `docsxai`, and the npm packages live on the registered `@docsxai` org (plus the bare `docsxai` package — the batteries-included CLI meta-package over `@docsxai/engine` + `@docsxai/viewer`). The old `site-docs` codename surfaces were retired in a pre-publish clean break (owner decision, 2026-06-12) — nothing had shipped, so there are no compatibility aliases.

| Surface      | Name                                                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo  | `kalebteccom/docsxai`                                                                                                                                                                                                                                                                                       |
| CLI          | `docsxai` (the engine bin)                                                                                                                                                                                                                                                                                  |
| npm packages | published: `docsxai` (the meta-package — one global install for the full CLI), `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`. Repo-only (`private: true`, revisitable post-flip): `@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-starlight` |
| Product name | docsxai                                                                                                                                                                                                                                                                                                     |

> **Status: public and published.** The repo is public and `0.2.0` is on npm (tag `v0.2.0`, 2026-06-26). `0.2.0` was published by hand: the `release.yml` run for that tag never started a job (GitHub reported failed account payments), so the packages went out from a maintainer machine with no provenance attestations and the GitHub Release has no SBOM. The OIDC path in `release.yml` has never run. This file is the mechanical checklist for the next release.

Apache-2.0 is in place, READMEs/CONTRIBUTING/CHANGELOG are written, and every package carries npm metadata (`repository`/`homepage`/`bugs`/`keywords`). Six packages publish: the bare `docsxai` meta-package (the real package, not a stub: its bin runs `@docsxai/engine`'s CLI in-process and its dependency on `@docsxai/viewer` makes `docsxai render` work from one global install) plus `@docsxai/{engine,plugin,backend,skill,viewer}`; `@docsxai/{mcp,plugin-confluence,plugin-starlight}` and `@docsxai/website` keep `"private": true` and stay repo-only (revisitable). From the next release on, publishing only happens through the OIDC workflow — no local `npm publish` path exists.

## Trust model

Releases use **npm Trusted Publishing via GitHub OIDC** — no `NPM_TOKEN` exists in this repo, in CI, or on a maintainer machine. A token that doesn't exist cannot leak.

- Publishing is tag-triggered only (`v*.*.*` on push). The workflow is unreachable from `pull_request*` events; PR-derived code can never request an OIDC token. A manual `workflow_dispatch` exists for the `dry-run` job alone, and `publish` and `github-release` carry `if: github.event_name == 'push'`, so a dispatch can never publish.
- `permissions: {}` at workflow level, narrowed per job. The `publish` job is the only place `id-token: write` exists.
- `environment: release` is referenced by the `publish` job. The environment does **not exist yet**: GitHub would create it unprotected on first use, so the required-reviewer gate and the branch/tag restriction are not in place until the owner configures them (see Release TODO below).
- npm-side: every published name (the bare `docsxai` meta-package and the five scoped packages) is bound to this exact repo + workflow filename + environment name. Anything else trying to publish under our identity fails closed.
- `--provenance` always — Sigstore attestation proves the artifact came from this workflow on this tagged commit.

## Cutting a release (in order)

Each step is mechanical:

1. **Pre-flight.** `pnpm install && pnpm -r build && pnpm -r typecheck && pnpm -r test` — all green (build first: typecheck resolves `@docsxai/*` through `dist/`). Full-history secret/identifier scan clean (the 2026-05-15 scrub holds; re-audit any docs added since). Run the [dry run](#dry-run) against your branch.
2. **Verify the publish set.** The six publishable manifests (`packages/docsxai` + `packages/{engine,plugin,backend,skill,viewer}`) carry no `"private"` flag; `@docsxai/{mcp,plugin-confluence,plugin-starlight}`, `@docsxai/website`, and the workspace root keep `"private": true`.
3. **Finalise the CHANGELOG.** Promote `## [Unreleased]` to `## [X.Y.Z] - <date>`; add the compare link.
4. **Version + tag.** Bump all six publishable packages to the same `X.Y.Z` (the workflow fails if any differs from the tag), commit `chore(release): vX.Y.Z`, then `git tag -s vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`.
5. **Publish.** The tag push triggers `release.yml`; approve the `release` environment gate (once it exists). The workflow publishes the six packages with provenance, attaches the SBOM, and creates the GitHub Release. Verify each package on npm — never publish locally. If a run dies midway, rerun the failed jobs: versions already on npm are skipped.
6. **Repo check.** The repo `kalebteccom/docsxai` is already public. Confirm the README renders on the release commit, the LICENSE is detected, CONTRIBUTING is linked.
7. **Site + announce.** Deploy the docs site (`website/` via Netlify) and verify DNS, then announce. The operational ordering (publish → site deploy → DNS checks) lives in `docs/ai-context/release-process/public-flip-checklist.md`.

## The bare `docsxai` package (meta-package)

`packages/docsxai/` is the official batteries-included install, published alongside the scoped packages (`0.2.0` is on npm) — it replaced the earlier throwing name-claim stub (owner decision, 2026-06-12). Shape:

- `bin.mjs` resolves `@docsxai/engine`'s CLI entry (`@docsxai/engine/cli`) and runs it **in-process** — no spawn, no PATH dependence.
- `index.mjs` / `index.d.mts` re-export the engine's library surface, so `import { parseFlowFile } from "docsxai"` works.
- Its dependencies are exactly `@docsxai/engine` + `@docsxai/viewer` (`workspace:*` in-repo, real versions on publish). The viewer dependency is deliberate: one `npm i -g docsxai` puts the `docsxai-viewer` bin on the global path, so `docsxai render` works out of the box through the engine's layered viewer resolution.
- No build step; the regression gate is `packages/docsxai/test/bin.test.ts`, which executes the bin as a subprocess (init + lint against a fixture workspace) and the library re-export.

## Workflow behavior

`.github/workflows/release.yml`. Four jobs; the pack, verify and publish logic is `scripts/release-publish.sh`, shared by `dry-run` and `publish`.

- `build` (push only; Node 26, `contents: read`): install, build, typecheck, test on the tagged commit.
- `dry-run` (`workflow_dispatch` only; `contents: read`, no `environment`, no `id-token`): install, build, `scripts/audit-package-contents.mjs`, then `scripts/release-publish.sh dry-run`.
- `publish` (push only; needs `build`; `environment: release`, `id-token: write` + `contents: read`): rebuilds, then `scripts/release-publish.sh publish`.
- `github-release` (push only; needs `publish`; `contents: write`): CycloneDX SBOM, then the GitHub Release with generated notes. A tag with a prerelease suffix is marked as a prerelease.

What `release-publish.sh` does:

- Packs the six packages (`pnpm pack`, which rewrites `workspace:*` to real versions) from an explicit allow-list that leaves out the repo-only packages (`@docsxai/{mcp,plugin-confluence,plugin-starlight,website}`), matching their `"private": true` flags.
- Verifies every tarball before the first publish: the manifest name matches, no `workspace:` spec is left, and on a tag push every version equals the tag (`vX.Y.Z` must match `X.Y.Z` in all six `package.json` files; the run fails otherwise). On a dry run the six versions must agree with each other.
- Publishes in dependency order: `@docsxai/engine`, `@docsxai/viewer`, `docsxai`, then `@docsxai/{plugin,skill,backend}`.
- Skips any package whose exact version already answers `npm view <name>@<version> version`, so a rerun after a partial publish finishes the rest. Any registry error other than 404 aborts.
- Publishes with `--provenance --access public`. A prerelease version (`X.Y.Z-rc.1`) gets `--tag next` so it never takes `latest`.

Common to every job: checkout with `persist-credentials: false` (ArtiPACKED mitigation), Node 26 against the npmjs.org registry with no package-manager cache (cache-poisoning mitigation per universal-baseline rule 26), and every action pinned to a commit SHA. The `dry-run` and `publish` jobs upgrade npm to the pinned `11.5.1` (the minimum for trusted publishing).

## Dry run

Rehearses everything except the OIDC exchange. From any branch (needs write access to the repo):

```sh
gh workflow run release.yml --ref <branch>
gh run watch
```

It proves install, build, the package-contents audit, that all six tarballs pack with `workspace:*` rewritten, the version-agreement check, the publish order and the exists-on-npm skip logic. While the tree still says `0.2.0`, it reports all six as already published and skips them.

It does not prove the trusted-publisher binding: `npm publish --dry-run` never exchanges an OIDC token. The only test of that is a real prerelease tag such as `v0.2.1-rc.1` (published under the `next` dist-tag), which is irreversible and an owner call.

## Release TODO

Owner tasks, tracked on the board, none done yet. These items must be in place before the workflow can publish. **Do not skip — the npm side fails closed without them, and the GitHub side fails open.**

- [ ] **Create the GitHub `release` environment** (it does not exist; GitHub would auto-create it unprotected on first use) with required reviewers. Restrict deployments to `main` and `release/*` branches and the `v*` tags.
- [ ] **Register npm Trusted Publisher bindings** (the 0.2.0 packages have none) — one per published name, 6 total: the bare `docsxai` meta-package plus the 5 scoped packages under the `@docsxai` org (org registered 2026-06-12): `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`. (`@docsxai/{mcp,plugin-confluence,plugin-starlight}` stay repo-only and need no binding until they flip.) On npmjs.com → package → Settings → Trusted Publishers, bind each to:
  - Repository: `kalebteccom/docsxai`
  - Workflow filename: `release.yml`
  - Environment name: `release`
- [ ] **Set `"Require 2FA and disallow tokens"`** on every published package after the first successful OIDC publish (universal-baseline rule 9).
- [ ] **Verify named-human owners ≥ 2** on the package and that both have phishing-resistant WebAuthn credentials (universal-baseline rules 1 + 7).

The pipeline already carries the build gate, SBOM emission, and the GitHub Release step. The first OIDC publish is untested. A reproducibility diff between two independent builds of the same tag remains designed-in but unwired — revisit later.

## Do NOT

- Do not `npm publish` — locally, ever. Publishing is OIDC-only via `release.yml`.
- Do not push a `v*.*.*` git tag casually: a tag triggers the release workflow.
- Do not remove the `"private": true` flags on `@docsxai/{mcp,plugin-confluence,plugin-starlight}`, `@docsxai/website`, or the workspace root as "cleanup" — they are the deliberate publish boundary.
