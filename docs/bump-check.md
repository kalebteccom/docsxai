# Bump check

Dependabot PRs for `astro`, `@astrojs/starlight` and `playwright-core` are held on purpose. The viewer's emitted sites pin exact astro and starlight versions, and screenshots are byte-identical only for one Chromium build. The normal gate runs neither check: its container has no Chromium and does not build an emitted site.

`.woodpecker/bump-check.yaml` runs both on a bump branch. It is manual only, not a required check, names no secrets and publishes nothing.

Start it from the Woodpecker UI: run a manual pipeline on the bump branch. Three steps run independently, so a failure names which half broke:

- `determinism`: fetches Chromium and runs the keystone suite (`packages/engine/test/keystone*.test.ts`), which includes the `--verify-determinism` comparison against a page with and without injected nondeterminism.
- `emitted-site`: emits a Starlight site for the sample pack with the engine CLI and builds it with the pinned astro and starlight.
- `og-card`: renders the social card with `pnpm -C website og` and copies the PNG to the visual host folder (`/srv/docsxai-visual/og-<pipeline>.png`). It never fails the run. Nothing is committed from CI: copy the file into `website/public/og.png` in a pull request.

A bump merges when `determinism` and `emitted-site` are green and the pinned-version test is updated in the same pull request.

Changing a `.woodpecker` file needs its hash on the CI allowlist first (`deploy/dev-vm/ci-guard/ci-guard-allow.py` in the trackxai repo prints the line), installed by whoever holds root on the dev VM, before the push.
