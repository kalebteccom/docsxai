# CI recipes

Nightly drift jobs for GitHub Actions, GitLab CI and Woodpecker. Copy one into the repository that holds your workspace. The guide is `docs/ci-recipes.md`.

## How the recipes are tested

`sample-repo/` is a minimal adopter repository: `docs-workspace/` (the path the recipes use) holds `.docsxai.json`, one flow, a committed doc pack under `docs/`, a committed `.baseline/` and a `pack.json`. Its flow, annotations and screenshot are the obstacles fixtures the engine and viewer suites already use, so the flow runs against `packages/engine/test/fixtures/toy-site/obstacles.html`.

`packages/engine/test/ci-recipes-sample-repo.test.ts` parses each recipe, takes its own `docsxai run ... --verify-determinism` and `docsxai diff ...` lines, points them at a copy of the sample repo and runs them through the real CLI:

- The diff step runs without a browser: no drift against the committed baseline (exit 0), a changed screenshot size over `--fail-on fail` (exit 1), a missing baseline (exit 2).
- The determinism step needs Chromium and skips without it: two runs agree, run 1 is promoted into the workspace and the run roots are removed.
- `docsxai pack` and `docsxai pack --check` are not in the recipes. They run against the same repo through the built viewer bin and skip when the viewer is not built.

`packages/engine/test/ci-examples.test.ts` covers the YAML shape, every command and flag against `docsxai --help`, and the copies in `docs/ci-recipes.md`.

## Dogfood nightly runs

The nightly runs for the dogfood workspaces live in the remotxai and trackxai repositories, not here: browser capture does not run in this repository's CI. Both workspaces adopt these recipes once `0.3.0-rc.1` is published, since the recipes install `docsxai` from npm.
