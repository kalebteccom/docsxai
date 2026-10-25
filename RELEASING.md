# Releasing docsxai

One name everywhere: the GitHub repo is `kalebteccom/docsxai` (renamed from `kalebteccom/automated-site-documentation-bot`), the CLI is `docsxai`, and the npm packages live on the registered `@docsxai` org (plus the bare `docsxai` package — the batteries-included CLI meta-package over `@docsxai/engine` + `@docsxai/viewer`). The old `site-docs` codename surfaces were retired in a pre-publish clean break (owner decision, 2026-06-12) — nothing had shipped, so there are no compatibility aliases.

| Surface      | Name                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub repo  | `kalebteccom/docsxai`                                                                                                                                                                                                                                                                                                                                                    |
| CLI          | `docsxai` (the engine bin)                                                                                                                                                                                                                                                                                                                                               |
| npm packages | published: `docsxai` (the meta-package — one global install for the full CLI), `@docsxai/engine`, `@docsxai/plugin`, `@docsxai/backend`, `@docsxai/skill`, `@docsxai/viewer`, `@docsxai/plugin-sharepoint` (experimental; ships since `0.3.0-rc.3`). Repo-only (`private: true`, revisitable): `@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-starlight` |
| Product name | docsxai                                                                                                                                                                                                                                                                                                                                                                  |

> **Status: public and published.** The repo is public and `0.2.0` is on npm (tag `v0.2.0`, 2026-06-26). `0.2.0` was published by hand: the `release.yml` run for that tag never started a job (GitHub never ran it), so the packages went out from a maintainer machine with no provenance attestations and the GitHub Release has no SBOM. Releases run in `.woodpecker/release.yaml`. The first Woodpecker release (`0.3.0-rc.3`) succeeded, and the GitHub Actions `release.yml` is retired.

Apache-2.0 is in place, READMEs/CONTRIBUTING/CHANGELOG are written, and every package carries npm metadata (`repository`/`homepage`/`bugs`/`keywords`). Seven packages publish: the bare `docsxai` meta-package (the real package, not a stub: its bin runs `@docsxai/engine`'s CLI in-process and its dependency on `@docsxai/viewer` makes `docsxai render` work from one global install) plus `@docsxai/{engine,plugin,backend,skill,viewer,plugin-sharepoint}`; `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-starlight}` and `@docsxai/website` keep `"private": true` and stay repo-only (revisitable). Nobody runs `npm publish` from a maintainer machine.

## Trust model

The release pipeline stages each version: `npm stage publish <tarball> --access public`, with `--tag next` for a prerelease and no provenance. A staged version is not live. A maintainer approves each one on npm with 2FA, so the gates before the stage call are:

1. **The manual trigger.** `.woodpecker/release.yaml` runs on the `manual` event only. A maintainer starts it for one tag. No push, pull request, tag or cron event starts it.
2. **The CI guard on the config files.** The CI server runs a `.woodpecker/*.yaml` file only when it is on an allowlist and its first line is `# ci-optimised: v1`. A changed release config does not run until it passes the guard.
3. **Tag equals HEAD.** `scripts/release-publish.sh` fetches the tag from `origin` and fails unless it points at the checked-out commit. Every package version must equal the tag.
4. **Verify and dry-run first.** `publish` depends on `setup`, `build`, `verify` (typecheck and tests) and `dry-run` (package contents audit, pack, verify, `--dry-run`). The script also packs and checks all seven tarballs before its first publish call.
5. **The secret is in one step.** Only the `publish` step names the publish secret. `dry-run` has no secret, and pull requests never see it.
6. **The token can only stage.** npm rejects a direct publish with it, so nothing goes live without a maintainer's 2FA approval.

The token's settings, storage, rotation and revocation steps are in the maintainers' private ops notes. `scripts/release-publish.sh` runs with `set +x`, never echoes the token, and removes its temporary npm config on exit. If npm answers with an auth, token or permission error (`E401`, `E403`, `ENEEDAUTH`, `EOTP`, or a message about two-factor), the script stops at once with "token or permission problem: stop and tell the owner" and publishes nothing further.

What staged mode gives up compared with GitHub OIDC:

- **No provenance.** `--provenance` needs a GitHub Actions or GitLab CI OIDC identity, so these releases carry no Sigstore attestation. The script passes `--provenance` only on GitHub Actions and `--provenance=false` everywhere else: every published `package.json` carries `publishConfig.provenance: true`, npm would refuse to publish from another runner with it ("Automatic provenance generation not supported for provider"), and a flag on the command line wins over `publishConfig`.
- **No trusted publishing.** npm trusted publishing binds a GitHub or GitLab workflow and issues a short-lived credential per run. This pipeline has no binding, so it publishes with a long-lived stage-only token.
- **A human step after the pipeline.** Approving a staged version needs a maintainer's 2FA, so a release is not finished when the pipeline is green.
- **No SBOM and no GitHub Release from CI.** The pipeline holds no GitHub token. A maintainer creates the release by hand (step 7 below).

npm has announced it will retire direct publishing with tokens that bypass 2FA, with a target of January 2027. The pipeline already runs in staged mode (see "Staged mode" below), so that change needs nothing here.

## Cutting a release (in order)

1. **Pre-flight.** The release pull request (version bump plus CHANGELOG) is green on Woodpecker at its head commit. Full-history secret/identifier scan clean (re-audit any docs added since the last scan).
2. **Verify the publish set.** The seven publishable manifests (`packages/docsxai` + `packages/{engine,plugin,backend,skill,viewer,plugin-sharepoint}`) carry no `"private"` flag; `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-starlight}`, `@docsxai/website`, and the workspace root keep `"private": true`.
3. **Finalise the CHANGELOG.** Promote `## [Unreleased]` to `## [X.Y.Z] - <date>`; add the compare link. Bump all seven publishable packages to the same `X.Y.Z` (the pipeline fails if any differs from the tag). Commit `chore(release): vX.Y.Z` in the release pull request.
4. **Merge.** Merge the release pull request on a green Woodpecker run at its head commit.
5. **Tag.** On the merge commit: `git tag -s vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`. The tag push starts nothing. It only names the commit that step 6 releases.
6. **Run the release pipeline.** In the Woodpecker UI, open the repo, choose "Run pipeline" (manual), pick the branch whose head is the tagged commit (`main` right after the merge), and add the variable `RELEASE_TAG` = `vX.Y.Z`. The pipeline installs, builds, typechecks and tests, then the `dry-run` step checks the tag and packs, and the `publish` step stages the seven packages. They are not live until the owner approves each one with 2FA (see "Staged mode"). The log prints `staged <package>@<version> (dist-tag <tag>)` for each. If `main` moved after tagging, the run fails before publishing (HEAD is not the tag). Push a branch at the tagged commit (`git push origin 'vX.Y.Z^{commit}:refs/heads/release/vX.Y.Z'`) and run the pipeline on that branch.
7. **GitHub Release.** After the owner has approved all seven and they are live: `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`, adding `--prerelease` for a `-rc.N` tag. Optionally attach an SBOM generated with `npx --yes @cyclonedx/cdxgen@12.5.1 -t pnpm -o sbom.cdx.json --project-name docsxai`.
8. **Repo check.** Confirm `npm view <package>@X.Y.Z` and `npm dist-tag ls <package>` for the seven, then that the README renders on the release commit, the LICENSE is detected, CONTRIBUTING is linked.
9. **Site + announce.** Deploy the docs site (`website/` via Netlify) and verify DNS, then announce.

If a run dies midway, approve or reject what it staged, then run the manual pipeline again with the same `RELEASE_TAG`: versions already on npm are skipped. If it died on "token or permission problem", do not rerun: a maintainer checks the token first.

### Staged mode

`.woodpecker/release.yaml` sets `RELEASE_PUBLISH_MODE=stage`. The script runs `npm stage publish` (needs npm >= 11.15.0 and Node >= 22.14.0), which uploads each version without making it live. The publish secret is a stage-only token; npm rejects a direct publish with it.

After a run, the owner promotes each staged version from a machine with 2FA: `npm stage list <package>` for the ids, `npm stage approve <stage-id> --otp <code>` to go live, `npm stage reject <stage-id>` to drop one.

`scripts/release-approve.mjs` does the seven approvals in one command. Run it from a checkout on a machine logged into npm. It reads the package list and order from `scripts/release-publish.sh`, runs `npm stage list <package> --json` for each, and prints a table of package, version, stage id and status. It refuses to continue when a stage is missing, duplicated, on the wrong dist-tag or not `ready` (a stage still `validating`: wait and rerun). The default is a dry run that prints the `npm stage approve <stage-id> --otp <code>` commands in order and changes nothing:

```sh
node scripts/release-approve.mjs v0.3.0-rc.4
node scripts/release-approve.mjs v0.3.0-rc.4 --approve
```

With `--approve` it asks for a fresh 2FA code before each package and passes it to npm through the child process environment, so it is not on a command line that `ps` shows. `--otp <code>` (repeatable, used in order, the last one reused) is the non-interactive form and does put the code in shell history and `ps`. It stops at the first failed approval and prints what is live and what is still staged; rerunning skips packages already live. At the end it checks `npm view <package>@<version> version` and the dist-tag for all seven. The script never reads or prints a token, never publishes, and never approves without a code. The manual commands above remain the fallback. A staged version is not on the registry, so a rerun with the same `RELEASE_TAG` tries to stage it again and npm refuses: approve or reject the earlier stage first.

## The bare `docsxai` package (meta-package)

`packages/docsxai/` is the official batteries-included install, published alongside the scoped packages (`0.2.0` is on npm) — it replaced the earlier throwing name-claim stub (owner decision, 2026-06-12). Shape:

- `bin.mjs` resolves `@docsxai/engine`'s CLI entry (`@docsxai/engine/cli`) and runs it **in-process** — no spawn, no PATH dependence.
- `index.mjs` / `index.d.mts` re-export the engine's library surface, so `import { parseFlowFile } from "docsxai"` works.
- Its dependencies are exactly `@docsxai/engine` + `@docsxai/viewer` (`workspace:*` in-repo, real versions on publish). The viewer dependency is deliberate: `docsxai render`, `burn`, `site` and `pack` find it through the engine's layered viewer resolution. A global install links only the top-level package's bins, so the meta package ships its own `docsxai-viewer` bin (`viewer-bin.mjs`, a shim to the viewer's CLI).
- No build step; the regression gate is `packages/docsxai/test/bin.test.ts`, which executes the bin as a subprocess (init + lint against a fixture workspace) and the library re-export.

## Pipeline behavior

`.woodpecker/release.yaml` (Woodpecker runs every file in `.woodpecker/` as its own workflow; `ci.yaml` next to it is the merge gate). Workflow-level `when: event: manual`. Same image as `ci.yaml`.

- `setup`: prints the Node and npm versions, then `pnpm install --frozen-lockfile --ignore-scripts` with a store in the container's `/tmp` (no shared cache).
- `build`: `pnpm build`.
- `verify` (needs `build`): `pnpm typecheck`, `pnpm test`.
- `dry-run` (needs `build`; no secret): `scripts/audit-package-contents.mjs`, then `scripts/release-publish.sh dry-run` with `RELEASE_REQUIRE_TAG=1`.
- `publish` (needs `verify` and `dry-run`; the only step with the secret): `scripts/release-publish.sh publish` with `RELEASE_PUBLISH_MODE=stage`. `dry-run` pins the same mode, so a too-old npm or Node fails before the secret is read.

What `release-publish.sh` does:

- Resolves the tag from `RELEASE_TAG`, or from `GITHUB_REF_NAME` on a GitHub tag push. `publish` fails without one; `dry-run` fails without one when `RELEASE_REQUIRE_TAG=1`.
- With a tag: checks it matches `vX.Y.Z[-pre]`, fetches it from `origin`, and fails unless `refs/tags/<tag>^{commit}` is `HEAD`.
- In stage mode (the Woodpecker setting), fails unless npm is at least 11.15.0 and Node at least 22.14.0.
- Fails unless its package list is exactly `docsxai`, `@docsxai/engine`, `@docsxai/viewer`, `@docsxai/plugin`, `@docsxai/skill`, `@docsxai/backend`, `@docsxai/plugin-sharepoint`.
- Packs the seven packages (`pnpm pack`, which rewrites `workspace:*` to real versions) from an explicit allow-list that leaves out the repo-only packages (`@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-starlight,website}`), matching their `"private": true` flags.
- Verifies every tarball before the first publish: the manifest name matches, no `workspace:` spec is left, and with a tag every version equals it. Without a tag the seven versions must agree with each other.
- Publishes in dependency order: `@docsxai/engine`, `@docsxai/viewer`, `docsxai`, then `@docsxai/{plugin,plugin-sharepoint,skill,backend}`.
- Skips any package whose exact version already answers `npm view <name>@<version> version`, so a rerun after a partial publish finishes the rest. Any registry error other than 404 aborts.
- `RELEASE_PUBLISH_MODE`: `direct` (the default) runs `npm publish`, with `--provenance` on GitHub Actions only; `stage` (set by `.woodpecker/release.yaml`) runs `npm stage publish` and passes `--provenance=false` off GitHub. Both pass `--access public`, and a prerelease version (`X.Y.Z-rc.1`) gets `--tag next` so it never takes `latest`.
- After each package, prints `staged <package>@<version> (dist-tag <tag>)` in stage mode and `published <package>@<version> (dist-tag <tag>)` in direct mode, then the `npm stage list` output and the approve and reject commands. It never prints the token.
- Stops at the first auth, token or permission error from npm (`E401`, `E403`, `ENEEDAUTH`, `EOTP`, two-factor) with "token or permission problem: stop and tell the owner", and stops at any other publish failure too. Nothing after the failed package is published.
- Off GitHub Actions, `publish` requires a non-empty `NODE_AUTH_TOKEN` and points npm at a temporary user config (mode 600, outside the workspace, removed on exit) that references it by name.

## Dry run

The `dry-run` step runs on every release pipeline before `publish`. A rehearsal still needs a pushed tag at the branch head. With the publish secret in place, a run stages for real.

## Sources

Checked 2026-10-09:

- Woodpecker secrets: available to push, tag and deployment events by default, not to `pull_request`; restrictable to listed events in the UI or CLI (`--event`). The docs do not say how the `manual` event interacts with that default, so the secret is restricted to exactly `manual`; the `0.3.0-rc.3` run read it in the `publish` step.
- Woodpecker workflows: a repo uses either `.woodpecker.yml` or a `.woodpecker/` directory; each `.woodpecker/*.yaml` is a workflow that runs independently.
- npm staged publishing: a stage-only granular token ("Read and write (stage only)") can run `npm stage publish` and cannot publish directly (`E_STAGE_REQUIRED`). A maintainer reviews with `npm stage list|view|download` and promotes with `npm stage approve <stage-id> --otp` (2FA) or drops with `npm stage reject`. Needs npm >= 11.15.0 and Node >= 22.14.
- npm provenance: `--provenance` works from GitHub Actions and GitLab CI only.
- npm granular tokens: can be limited to packages and to allowed IP ranges, carry an expiry, and can be set to bypass 2FA for publishing. npm has announced the retirement of bypass-2FA tokens with a target of January 2027.

## Do NOT

- Do not `npm publish` locally, ever. Releases go through `.woodpecker/release.yaml`.
- Do not push a `v*.*.*` git tag casually: the next manual Woodpecker release pipeline publishes whatever tag it is given.
- Do not remove the `"private": true` flags on `@docsxai/{mcp,plugin-confluence,plugin-gitbook,plugin-guru,plugin-notion,plugin-starlight}`, `@docsxai/website`, or the workspace root as "cleanup" — they are the deliberate publish boundary.
