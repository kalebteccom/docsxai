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

The Woodpecker pipeline publishes directly: `npm publish <tarball> --access public`, with `--tag next` for a prerelease and no provenance. A version is live on npm as soon as the `publish` step accepts it. Nobody approves it afterwards, so every gate sits before the publish call:

1. **The manual trigger.** `.woodpecker/release.yaml` runs on the `manual` event only. The owner, or an agent the owner authorises for that release, starts it from the Woodpecker UI (ops.kalebtec.com) for one tag. No push, pull request, tag or cron event starts it.
2. **The CI guard on the config files.** The CI host's guard runs a `.woodpecker/*.yaml` file only when it is on the guard's allowlist and its first line is `# ci-optimised: v1`. A changed release config does not run until it passes the guard.
3. **Tag equals HEAD.** `scripts/release-publish.sh` fetches the tag from `origin` and fails unless it points at the checked-out commit. Every package version must equal the tag.
4. **Verify and dry-run first.** `publish` depends on `setup`, `build`, `verify` (typecheck and tests) and `dry-run` (package contents audit, pack, verify, `--dry-run`). The script also packs and checks all six tarballs before its first publish call.
5. **The secret is in one step.** Only the `publish` step names `npm_publish_token`. `dry-run` has no secret.
6. **The secret is limited to the manual event.** The repo admin restricts `npm_publish_token` to exactly `manual`.

The token is a granular npm publish token with "bypass 2FA" set, IP-locked to the CI box, limited to the six published packages, with a 90-day expiry.

Rules for the secret:

- Name: `npm_publish_token`, a repository secret in Woodpecker. Only the `publish` step of `.woodpecker/release.yaml` names it, as `NODE_AUTH_TOKEN`.
- Events: the repo admin restricts the secret to exactly `manual`. Woodpecker exposes a secret to push, tag and deployment events by default and never to `pull_request` (checked 2026-10-09); the restriction removes push, tag and deployment too. Do not leave it at the default. Do not restrict it to plugin images, since the publish step is a command step.
- Never exposed to pull requests or PR-derived code: `.woodpecker/ci.yaml` runs on push only and names no secret, Woodpecker runs with `allow_pr=false`, and the release pipeline runs only on a commit that a pushed tag points at.
- The owner keeps the token in `~/.config/docsxai/npm-publish.token` (mode 600) on the CI host, and the Woodpecker secret is created from that file. Nobody prints, pastes or commits the value. `scripts/release-publish.sh` runs with `set +x`, never echoes the variable, and writes an npm user config outside the workspace that holds `${NODE_AUTH_TOKEN}` as a placeholder, which npm expands when it reads it. The file has mode 600 and is removed when the script exits.
- If npm answers with an auth, token or permission error (`E401`, `E403`, `ENEEDAUTH`, `EOTP`, or a message about two-factor), the script stops at once with "token or permission problem: stop and tell the owner" and publishes nothing further. Do not retry with another token: tell the owner.

What direct mode on Woodpecker gives up compared with GitHub OIDC:

- **No provenance.** `--provenance` needs a GitHub Actions or GitLab CI OIDC identity, so Woodpecker releases carry no Sigstore attestation. The script passes `--provenance` only on GitHub Actions.
- **No trusted publishing.** npm trusted publishing binds a GitHub or GitLab workflow and issues a short-lived credential per run. Woodpecker has no binding, so it publishes with a long-lived token. The trusted-publisher bindings in the Release TODO apply to `release.yml` only.
- **No 2FA on each publish.** The token bypasses 2FA, so no human confirms a version at publish time. The manual trigger is the last human step.
- **No SBOM and no GitHub Release from CI.** The pipeline holds no GitHub token. The owner creates the release by hand (step 7 below).

Risks of a bypass-2FA token on a shared CI box, and their mitigations:

- **Someone with access to the CI host reads the token** (the token file, the Woodpecker secret store or a running publish container). Mitigations: the IP lock means the token works only from the CI box's address, so a copy is useless elsewhere; the token covers the six packages and nothing else in the account; it expires after 90 days.
- **A changed pipeline or script misuses the token.** Mitigations: the CI guard allowlist on `.woodpecker/*.yaml`, the `manual`-only event restriction on the secret, the secret named in one step, and the script's fixed six-package list.
- **A wrong or partial release goes live.** Mitigations: tag equals HEAD, verify and dry-run before publish, all six packed and checked before the first publish call. A bad version can be deprecated but its number cannot be reused, so the fix is a new patch release.

Rotation, before the 90-day expiry and whenever anyone other than the owner may have read the CI host's secret store:

1. On npmjs.com, create a new granular token with the same settings: publish permission, bypass 2FA, the six packages only, the CI box's IP as the only allowed range, 90-day expiry.
2. Overwrite `~/.config/docsxai/npm-publish.token` on the CI host (mode 600).
3. Update the Woodpecker secret `npm_publish_token` from that file, keeping the name and the `manual` event restriction.
4. Revoke the old token on npmjs.com (Access Tokens).

Revocation, when the token may have leaked: revoke it on npmjs.com (Access Tokens) first, then delete the Woodpecker secret and the token file. Check each of the six packages on npmjs.com for versions nobody released; deprecate any with `npm deprecate` from a maintainer machine with 2FA.

Planned change on npm's side: npm has announced it will retire tokens that bypass 2FA, with a target of January 2027. The date is not a promise. When that happens, the fallback is a stage-only token plus `RELEASE_PUBLISH_MODE=stage` (see "Staged mode (inactive)" below).

Residual exposure, accepted for now: the pipeline uses the `remotxai-ci:latest` image of the shared CI host (not pinned by digest), and installs from the registry against the frozen lockfile with `--ignore-scripts` and no shared pnpm store. The pack step runs with lifecycle scripts disabled (`npm_config_ignore_scripts`).

## Cutting a release (in order)

1. **Pre-flight.** The release pull request (version bump plus CHANGELOG) is green on Woodpecker at its head commit. Full-history secret/identifier scan clean (the 2026-05-15 scrub holds; re-audit any docs added since).
2. **Verify the publish set.** The six publishable manifests (`packages/docsxai` + `packages/{engine,plugin,backend,skill,viewer}`) carry no `"private"` flag; `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight}`, `@docsxai/website`, and the workspace root keep `"private": true`.
3. **Finalise the CHANGELOG.** Promote `## [Unreleased]` to `## [X.Y.Z] - <date>`; add the compare link. Bump all six publishable packages to the same `X.Y.Z` (the pipeline fails if any differs from the tag). Commit `chore(release): vX.Y.Z` in the release pull request.
4. **Merge.** Merge the release pull request on a green Woodpecker run at its head commit.
5. **Tag.** On the merge commit: `git tag -s vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`. While `release.yml` exists, this push also starts it; its `publish` job waits on the `release` environment approval. Do not approve it: leave it waiting or cancel it, so only one path publishes.
6. **Run the release pipeline.** In the Woodpecker UI, open the repo, choose "Run pipeline" (manual), pick the branch whose head is the tagged commit (`main` right after the merge), and add the variable `RELEASE_TAG` = `vX.Y.Z`. The pipeline installs, builds, typechecks and tests, then the `dry-run` step checks the tag and packs, and the `publish` step publishes the six packages. They are live when the step finishes. The log prints `published <package>@<version> (dist-tag <tag>)` for each. If `main` moved after tagging, the run fails before publishing (HEAD is not the tag). Push a branch at the tagged commit (`git push origin 'vX.Y.Z^{commit}:refs/heads/release/vX.Y.Z'`) and run the pipeline on that branch. The UI labels and how manual variables reach the steps are to verify on the first run.
7. **GitHub Release.** After all six are live: `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`, adding `--prerelease` for a `-rc.N` tag. Optionally attach an SBOM generated with `npx --yes @cyclonedx/cdxgen@12.5.1 -t pnpm -o sbom.cdx.json --project-name docsxai`.
8. **Repo check.** Confirm `npm view <package>@X.Y.Z` and `npm dist-tag ls <package>` for the six, then that the README renders on the release commit, the LICENSE is detected, CONTRIBUTING is linked.
9. **Site + announce.** Deploy the docs site (`website/` via Netlify) and verify DNS, then announce. The operational ordering (publish, site deploy, DNS checks) lives in `docs/ai-context/release-process/public-flip-checklist.md`.

If a run dies midway, run the manual pipeline again with the same `RELEASE_TAG`: versions already on npm are skipped. If it died on "token or permission problem", do not rerun: the owner checks the token (expiry, IP lock, package scope) and rotates it first.

### Staged mode (inactive)

The script keeps a `stage` mode for the day npm retires bypass-2FA tokens. With `RELEASE_PUBLISH_MODE=stage` it runs `npm stage publish` (needs npm >= 11.15.0 and Node >= 22.14.0), which uploads each version without making it live; the owner then promotes each with `npm stage approve <stage-id> --otp <code>` or drops it with `npm stage reject <stage-id>`. It needs a stage-only granular token ("Read and write (stage only)"). Nothing in the pipeline selects it: switching is a reviewed change to `.woodpecker/release.yaml` plus a new token.

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
- `publish` (needs `verify` and `dry-run`; the only step with the secret): `scripts/release-publish.sh publish` with `RELEASE_PUBLISH_MODE=direct`. `dry-run` pins the same mode.

What `release-publish.sh` does (shared by both runners):

- Resolves the tag from `RELEASE_TAG`, or from `GITHUB_REF_NAME` on a GitHub tag push. `publish` fails without one; `dry-run` fails without one when `RELEASE_REQUIRE_TAG=1`.
- With a tag: checks it matches `vX.Y.Z[-pre]`, fetches it from `origin`, and fails unless `refs/tags/<tag>^{commit}` is `HEAD`.
- In stage mode (inactive), fails unless npm is at least 11.15.0 and Node at least 22.14.0.
- Fails unless its package list is exactly `docsxai`, `@docsxai/engine`, `@docsxai/viewer`, `@docsxai/plugin`, `@docsxai/skill`, `@docsxai/backend`.
- Packs the six packages (`pnpm pack`, which rewrites `workspace:*` to real versions) from an explicit allow-list that leaves out the repo-only packages (`@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight,website}`), matching their `"private": true` flags.
- Verifies every tarball before the first publish: the manifest name matches, no `workspace:` spec is left, and with a tag every version equals it. Without a tag the six versions must agree with each other.
- Publishes in dependency order: `@docsxai/engine`, `@docsxai/viewer`, `docsxai`, then `@docsxai/{plugin,skill,backend}`.
- Skips any package whose exact version already answers `npm view <name>@<version> version`, so a rerun after a partial publish finishes the rest. Any registry error other than 404 aborts.
- `RELEASE_PUBLISH_MODE`: `direct` (the default on every runner) runs `npm publish`, with `--provenance` on GitHub Actions only; `stage` (inactive) runs `npm stage publish`. Both pass `--access public`, and a prerelease version (`X.Y.Z-rc.1`) gets `--tag next` so it never takes `latest`.
- After each publish, prints `published <package>@<version> (dist-tag <tag>)`. It never prints the token.
- Stops at the first auth, token or permission error from npm (`E401`, `E403`, `ENEEDAUTH`, `EOTP`, two-factor) with "token or permission problem: stop and tell the owner", and stops at any other publish failure too. Nothing after the failed package is published.
- Off GitHub Actions, `publish` requires a non-empty `NODE_AUTH_TOKEN` and points npm at a temporary user config (mode 600, outside the workspace, removed on exit) that references it by name.

## GitHub Actions (until retired)

`.github/workflows/release.yml` is unchanged, but it calls the same `scripts/release-publish.sh` as the Woodpecker pipeline, which now also fetches the tag and requires it to equal HEAD (an unauthenticated fetch from a public repo; it would fail if the repository went private). It still publishes on a `v*.*.*` tag push behind the `release` environment, over OIDC with provenance, then creates the GitHub Release with an SBOM. Its `dry-run` job runs on `workflow_dispatch` (`gh workflow run release.yml --ref <branch>`) and needs no credentials. It stays until the first Woodpecker release succeeds; a follow-up change then deletes it, and from then on nothing release-related runs on GitHub Actions.

## Dry run

The `dry-run` step runs on every release pipeline before `publish`. To rehearse without publishing, delete or disable the `npm_publish_token` secret first: the `publish` step then fails on the empty token before any registry call. A rehearsal still needs a pushed tag at the branch head. With the secret in place, a run publishes for real.

While `release.yml` exists, its `dry-run` job rehearses from any branch with no tag.

## Release TODO

Owner tasks. **The pipeline cannot publish until the Woodpecker secret exists and the package settings accept the token.**

- [x] **Create the npm token** on npmjs.com: granular access token with publish permission and "bypass 2FA", limited to the six published packages, IP-locked to the CI box, 90-day expiry. It lives in `~/.config/docsxai/npm-publish.token` on the CI host, mode 600.
- [ ] **Add the Woodpecker secret** `npm_publish_token` from that file, events restricted to exactly `manual`, no image restriction. With the CLI the shape is `woodpecker-cli repo secret add --repository kalebteccom/docsxai --name npm_publish_token --event manual --value @<file>` (flags to verify against the installed CLI version).
- [ ] **Set a rotation reminder** a week before the token's 90-day expiry, and rotate with the steps in the Trust model. An expired token fails the `publish` step with an auth error.
- [ ] **Check the package settings:** "Require two-factor authentication and disallow tokens" on a package refuses token publishes, bypass-2FA or not. Each of the six needs a setting that accepts the token.
- [ ] **Confirm the image toolchain:** `remotxai-ci:latest` carries npm and git. The `setup` step prints the versions. npm >= 11.15.0 and Node >= 22.14.0 matter only for stage mode.
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
- npm granular tokens: can be limited to packages and to allowed IP ranges, carry an expiry, and can be set to bypass 2FA for publishing. npm has announced the retirement of bypass-2FA tokens with a target of January 2027.

## Do NOT

- Do not `npm publish` locally, ever. Releases go through `.woodpecker/release.yaml` (or `release.yml` until it is retired).
- Do not push a `v*.*.*` git tag casually: while `release.yml` exists a tag starts it, and the Woodpecker release pipeline releases whatever tag it is given.
- Do not remove the `"private": true` flags on `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-sharepoint,plugin-starlight}`, `@docsxai/website`, or the workspace root as "cleanup" — they are the deliberate publish boundary.
