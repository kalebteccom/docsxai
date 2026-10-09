# Releasing docsxai

One name everywhere: the GitHub repo is `kalebteccom/docsxai` (renamed from `kalebteccom/automated-site-documentation-bot`), the CLI is `docsxai`, and the npm packages live on the registered `@docsxai` org (plus the bare `docsxai` package — the batteries-included CLI meta-package over `@docsxai/engine` + `@docsxai/viewer`). The old `site-docs` codename surfaces were retired in a pre-publish clean break (owner decision, 2026-06-12) — nothing had shipped, so there are no compatibility aliases.

| Surface      | Name                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo  | `kalebteccom/docsxai`                                                                                                                                                                                                                                                                             |
| CLI          | `docsxai` (the engine bin)                                                                                                                                                                                                                                                                        |
| npm packages | published: `docsxai` (the meta-package — one global install for the full CLI), `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`. Repo-only (`private: true`, revisitable): `@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-starlight` |
| Product name | docsxai                                                                                                                                                                                                                                                                                           |

> **Status: public and published.** The repo is public and `0.2.0` is on npm (tag `v0.2.0`, 2026-06-26). `0.2.0` was published by hand: the `release.yml` run for that tag never started a job (GitHub reported failed account payments), so the packages went out from a maintainer machine with no provenance attestations and the GitHub Release has no SBOM. Releases now run on Woodpecker (`.woodpecker/release.yaml`), on the same CI host as the merge gate. `release.yml` stays until the first Woodpecker release succeeds; a follow-up change then deletes it. Neither path has published yet.

Apache-2.0 is in place, READMEs/CONTRIBUTING/CHANGELOG are written, and every package carries npm metadata (`repository`/`homepage`/`bugs`/`keywords`). Six packages publish: the bare `docsxai` meta-package (the real package, not a stub: its bin runs `@docsxai/engine`'s CLI in-process and its dependency on `@docsxai/viewer` makes `docsxai render` work from one global install) plus `@docsxai/{engine,plugin,backend,skill,viewer}`; `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight}` and `@docsxai/website` keep `"private": true` and stay repo-only (revisitable). Nobody runs `npm publish` from a maintainer machine.

## Trust model

A release has two gates, both held by the owner:

1. **The manual run.** `.woodpecker/release.yaml` triggers on the `manual` event only. The owner starts it from the Woodpecker UI (ops.kalebtec.com) for one tag. No push, pull request, tag or cron event starts it.
2. **The npm stage approval.** The pipeline runs `npm stage publish`, which uploads each version without making it live. The owner reviews the stage and promotes it with `npm stage approve <stage-id> --otp <code>` on a machine with their 2FA. Until then nothing is installable.

The token is a **stage-only** granular npm token ("Read and write (stage only)"). It cannot publish directly: npm answers `E_STAGE_REQUIRED`. A leaked token can stage versions but cannot make one live without the owner's 2FA.

Rules for the secret:

- Name: `npm_publish_token`, a repository secret in Woodpecker. Only the `publish` step of `.woodpecker/release.yaml` names it, as `NODE_AUTH_TOKEN`.
- Events: the repo admin restricts the secret to exactly `manual`. Woodpecker exposes a secret to push, tag and deployment events by default and never to `pull_request` (checked 2026-10-09); the restriction removes push, tag and deployment too. Do not leave it at the default. Do not restrict it to plugin images, since the publish step is a command step.
- Never exposed to pull requests or PR-derived code: `.woodpecker/ci.yaml` runs on push only and names no secret, Woodpecker runs with `allow_pr=false`, and the release pipeline runs only on a commit that a pushed tag points at.
- The owner creates the token on npmjs.com and writes it to `~/.config/docsxai/npm-publish.token` (mode 600) on the CI host. The Woodpecker secret is created from that file. Nobody prints, pastes or commits the value. `scripts/release-publish.sh` runs with `set +x`, never echoes the variable, and writes an npm user config outside the workspace that holds `${NODE_AUTH_TOKEN}` as a placeholder, which npm expands when it reads it. The file is removed when the script exits.
- Rotation: create a new stage-only token on npmjs.com, overwrite the file, update the Woodpecker secret from it (same name, same `manual` event restriction), then revoke the old token on npmjs.com. Rotate at least when the token's expiry nears and whenever anyone other than the owner may have read the CI host's secret store.
- Revocation: revoke the token on npmjs.com (Access Tokens) and delete the Woodpecker secret. A staged version that nobody approved can be dropped with `npm stage reject <stage-id>`.

What the move from GitHub Actions gives up:

- **No provenance.** `npm publish --provenance` needs a GitHub Actions or GitLab CI OIDC identity, so Woodpecker releases carry no Sigstore attestation. The script passes `--provenance` only on GitHub Actions.
- **No trusted publishing.** npm trusted publishing binds a GitHub or GitLab workflow; Woodpecker has no binding, so it publishes with a token. The trusted-publisher bindings in the Release TODO apply to `release.yml` only.
- **No SBOM and no GitHub Release from CI.** The pipeline holds no GitHub token. The owner creates the release by hand (step 8 below).

Residual exposure, accepted for now: the pipeline uses the `remotxai-ci:latest` image of the shared CI host (not pinned by digest), and installs from the registry against the frozen lockfile with `--ignore-scripts` and no shared pnpm store. The pack step runs with lifecycle scripts disabled (`npm_config_ignore_scripts`).

## Cutting a release (in order)

1. **Pre-flight.** The release pull request (version bump plus CHANGELOG) is green on Woodpecker at its head commit. Full-history secret/identifier scan clean (the 2026-05-15 scrub holds; re-audit any docs added since).
2. **Verify the publish set.** The six publishable manifests (`packages/docsxai` + `packages/{engine,plugin,backend,skill,viewer}`) carry no `"private"` flag; `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight}`, `@docsxai/website`, and the workspace root keep `"private": true`.
3. **Finalise the CHANGELOG.** Promote `## [Unreleased]` to `## [X.Y.Z] - <date>`; add the compare link. Bump all six publishable packages to the same `X.Y.Z` (the pipeline fails if any differs from the tag). Commit `chore(release): vX.Y.Z` in the release pull request.
4. **Merge.** Merge the release pull request on a green Woodpecker run at its head commit.
5. **Tag.** On the merge commit: `git tag -s vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`. While `release.yml` exists, this push also starts it; its `publish` job waits on the `release` environment approval. Do not approve it: leave it waiting or cancel it, so only one path publishes.
6. **Run the release pipeline.** In the Woodpecker UI, open the repo, choose "Run pipeline" (manual), pick the branch whose head is the tagged commit (`main` right after the merge), and add the variable `RELEASE_TAG` = `vX.Y.Z`. The pipeline installs, builds, typechecks and tests, then the `dry-run` step checks the tag and packs, and the `publish` step stages the six packages. If `main` moved after tagging, the run fails before publishing (HEAD is not the tag). Push a branch at the tagged commit (`git push origin 'vX.Y.Z^{commit}:refs/heads/release/vX.Y.Z'`) and run the pipeline on that branch. The UI labels and how manual variables reach the steps are to verify on the first run.
7. **Review and approve the stage.** On a machine with your 2FA: `npm stage list <package>` and `npm stage view <stage-id>` (or `npm stage download <stage-id>` to inspect the tarball), then `npm stage approve <stage-id> --otp <code>` for each of the six packages, in the publish order below. `npm stage reject <stage-id>` drops one. The pipeline log prints the stage ids and the `npm stage list` output.
8. **GitHub Release.** After all six are live: `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`, adding `--prerelease` for a `-rc.N` tag. Optionally attach an SBOM generated with `npx --yes @cyclonedx/cdxgen@12.5.1 -t pnpm -o sbom.cdx.json --project-name docsxai`.
9. **Repo check.** Confirm the README renders on the release commit, the LICENSE is detected, CONTRIBUTING is linked.
10. **Site + announce.** Deploy the docs site (`website/` via Netlify) and verify DNS, then announce. The operational ordering (publish, site deploy, DNS checks) lives in `docs/ai-context/release-process/public-flip-checklist.md`.

If a run dies midway, run the manual pipeline again with the same `RELEASE_TAG`: versions already on npm are skipped. A version that is staged but not approved is not on npm yet, so a rerun stages it again; reject the duplicate stage (to verify on the first partial run).

### Direct mode

`RELEASE_PUBLISH_MODE=direct` makes the script run `npm publish` (no provenance off GitHub Actions). In direct mode the manual run is the only gate, and a stage-only token cannot publish, so the secret would have to be a token that bypasses 2FA. npm is retiring those (announced target January 2027, not a promise). The pipeline pins `stage`; switching is a reviewed change to `.woodpecker/release.yaml` plus a different token, and is not recommended.

## The bare `docsxai` package (meta-package)

`packages/docsxai/` is the official batteries-included install, published alongside the scoped packages (`0.2.0` is on npm) — it replaced the earlier throwing name-claim stub (owner decision, 2026-06-12). Shape:

- `bin.mjs` resolves `@docsxai/engine`'s CLI entry (`@docsxai/engine/cli`) and runs it **in-process** — no spawn, no PATH dependence.
- `index.mjs` / `index.d.mts` re-export the engine's library surface, so `import { parseFlowFile } from "docsxai"` works.
- Its dependencies are exactly `@docsxai/engine` + `@docsxai/viewer` (`workspace:*` in-repo, real versions on publish). The viewer dependency is deliberate: one `npm i -g docsxai` puts the `docsxai-viewer` bin on the global path, so `docsxai render` works out of the box through the engine's layered viewer resolution.
- No build step; the regression gate is `packages/docsxai/test/bin.test.ts`, which executes the bin as a subprocess (init + lint against a fixture workspace) and the library re-export.

## Pipeline behavior

`.woodpecker/release.yaml` (Woodpecker runs every file in `.woodpecker/` as its own workflow; `ci.yaml` next to it is the merge gate). Workflow-level `when: event: manual`. Same image and gate slots as `ci.yaml`.

- `setup`: prints the Node and npm versions, then `pnpm install --frozen-lockfile --ignore-scripts` with a store in the container's `/tmp` (no shared cache).
- `build`: `pnpm build`.
- `verify` (needs `build`): `pnpm typecheck`, `pnpm test`, the checks of the `build` job in `release.yml`.
- `dry-run` (needs `build`; no secret): `scripts/audit-package-contents.mjs`, then `scripts/release-publish.sh dry-run` with `RELEASE_REQUIRE_TAG=1`.
- `publish` (needs `verify` and `dry-run`; the only step with the secret): `scripts/release-publish.sh publish` with `RELEASE_PUBLISH_MODE=stage`.

What `release-publish.sh` does (shared by both runners):

- Resolves the tag from `RELEASE_TAG`, or from `GITHUB_REF_NAME` on a GitHub tag push. `publish` fails without one; `dry-run` fails without one when `RELEASE_REQUIRE_TAG=1`.
- With a tag: checks it matches `vX.Y.Z[-pre]`, fetches it from `origin`, and fails unless `refs/tags/<tag>^{commit}` is `HEAD`.
- In stage mode, fails unless npm is at least 11.15.0 and Node at least 22.14.0.
- Packs the six packages (`pnpm pack`, which rewrites `workspace:*` to real versions) from an explicit allow-list that leaves out the repo-only packages (`@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight,website}`), matching their `"private": true` flags.
- Verifies every tarball before the first publish: the manifest name matches, no `workspace:` spec is left, and with a tag every version equals it. Without a tag the six versions must agree with each other.
- Publishes in dependency order: `@docsxai/engine`, `@docsxai/viewer`, `docsxai`, then `@docsxai/{plugin,skill,backend}`.
- Skips any package whose exact version already answers `npm view <name>@<version> version`, so a rerun after a partial publish finishes the rest. Any registry error other than 404 aborts.
- `RELEASE_PUBLISH_MODE`: `stage` (default off GitHub Actions) runs `npm stage publish`; `direct` (default on GitHub Actions) runs `npm publish`, with `--provenance` on GitHub Actions only. Both pass `--access public`, and a prerelease version (`X.Y.Z-rc.1`) gets `--tag next` so it never takes `latest`.
- Off GitHub Actions, `publish` requires `NODE_AUTH_TOKEN` and points npm at a temporary user config outside the workspace that references it.

## GitHub Actions (until retired)

`.github/workflows/release.yml` is unchanged, but it calls the same `scripts/release-publish.sh` as the Woodpecker pipeline, which now also fetches the tag and requires it to equal HEAD (an unauthenticated fetch from a public repo; it would fail if the repository went private). It still publishes on a `v*.*.*` tag push behind the `release` environment, over OIDC with provenance, then creates the GitHub Release with an SBOM. Its `dry-run` job runs on `workflow_dispatch` (`gh workflow run release.yml --ref <branch>`) and needs no credentials. It stays until the first Woodpecker release succeeds; a follow-up change then deletes it, and from then on nothing release-related runs on GitHub Actions.

## Dry run

The `dry-run` step runs on every release pipeline before `publish`. To rehearse without staging anything, delete or disable the `npm_publish_token` secret first: the `publish` step then fails on the empty token before any registry call. A rehearsal still needs a pushed tag at the branch head. With the secret in place, a rehearsal stages versions that you then reject with `npm stage reject`.

While `release.yml` exists, its `dry-run` job rehearses from any branch with no tag.

## Release TODO

Owner tasks. **The pipeline cannot stage anything until the first three are done.**

- [ ] **Create the stage-only npm token** on npmjs.com: granular access token, permission "Read and write (stage only)", scoped to the six published packages (and the `@docsxai` org), with an expiry. Write it to `~/.config/docsxai/npm-publish.token` on the CI host, mode 600.
- [ ] **Add the Woodpecker secret** `npm_publish_token` from that file, events restricted to exactly `manual`, no image restriction. With the CLI the shape is `woodpecker-cli repo secret add --repository kalebteccom/docsxai --name npm_publish_token --event manual --value @<file>` (flags to verify against the installed CLI version).
- [ ] **Confirm the image toolchain:** `remotxai-ci:latest` carries npm >= 11.15.0, Node >= 22.14.0 and git. The `setup` step prints the versions and the script fails in `dry-run` when npm is too old.
- [ ] **Check the package settings:** "Require two-factor authentication and disallow tokens" on a package may refuse even a stage-only token. Verify on the first run which setting lets `npm stage publish` through while keeping direct token publishes off.
- [ ] **Verify named-human owners >= 2** on the packages and that both have phishing-resistant WebAuthn credentials (universal-baseline rules 1 + 7).
- [ ] **Retire `release.yml`** after the first Woodpecker release succeeds, in its own change. Then drop the `release` environment and the trusted-publisher TODO below.
- [x] **Protected GitHub `release` environment** (done 2026-10-05, for `release.yml`): required reviewer `rowinbot`, tag restriction `v*.*.*`, no wait timer.
- [ ] **npm Trusted Publisher bindings** for `release.yml` (only needed if `release.yml` publishes before it is retired): `npm trust github <package> --file release.yml --repo kalebteccom/docsxai --env release --allow-publish` for each of the six names, with 2FA.

## Sources

Checked 2026-10-09:

- Woodpecker secrets: available to push, tag and deployment events by default, not to `pull_request`; restrictable to listed events in the UI or CLI (`--event`). The docs do not say how the `manual` event interacts with that default, so the secret is restricted to exactly `manual` and the first run verifies it.
- Woodpecker workflows: a repo uses either `.woodpecker.yml` or a `.woodpecker/` directory; each `.woodpecker/*.yaml` is a workflow that runs independently.
- npm staged publishing: a stage-only granular token ("Read and write (stage only)") can run `npm stage publish` and cannot publish directly (`E_STAGE_REQUIRED`). A maintainer reviews with `npm stage list|view|download` and promotes with `npm stage approve <stage-id> --otp` (2FA) or drops with `npm stage reject`. Needs npm >= 11.15.0 and Node >= 22.14.
- npm provenance: `--provenance` works from GitHub Actions and GitLab CI only.

## Do NOT

- Do not `npm publish` locally, ever. Releases go through `.woodpecker/release.yaml` (or `release.yml` until it is retired).
- Do not push a `v*.*.*` git tag casually: while `release.yml` exists a tag starts it, and the Woodpecker release pipeline releases whatever tag it is given.
- Do not remove the `"private": true` flags on `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight}`, `@docsxai/website`, or the workspace root as "cleanup" — they are the deliberate publish boundary.
