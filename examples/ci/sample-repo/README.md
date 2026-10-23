# Sample adopter repository

A minimal repository that the nightly drift recipes in `examples/ci/` run against. `docs-workspace/` is the path the recipes use. It holds `.docsxai.json`, `flows/obstacles.flow.yaml`, a committed doc pack under `docs/`, a committed `.baseline/` and a `pack.json`.

The flow targets the engine's test page, `packages/engine/test/fixtures/toy-site/obstacles.html`. Its `app_url` is a placeholder; pass `--base-url` to run it against a real app.

## Run it

Needs `docsxai@next` (0.3.0-rc.3 or later) installed. The diff needs no browser.

```bash
docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail
```

Expect `# docsxai drift report`, then `No drift detected.` and exit code 0. Change `docs/obstacles/screenshots/share.png` and the same command lists `obstacles` and exits 1. Remove `.baseline/` and it exits 2.

With Chromium installed (`npx playwright-core install chromium`) and the toy site served or opened by file URL:

```bash
docsxai run ./docs-workspace --base-url <toy-site-url> --verify-determinism --format md
```

Expect `## docsxai determinism check` and `**IDENTICAL**`, exit code 0, and the workspace's `docs/obstacles/` refreshed with run 1's files.

`docsxai pack ./docs-workspace --no-optimise` writes `.screens/manifest.json` next to it; `pack --check --against .screens` then exits 0.
