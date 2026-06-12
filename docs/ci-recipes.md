# CI recipes — deterministic doc refresh in your pipeline

> The first-class CI surface is the **docsxai GitHub App** (webhook on the
> backend; install-and-go, zero YAML in your repo — see
> `packages/backend/README.md`). The recipes below are the documented
> _examples_ for teams that prefer to drive `site-docs run` from their own
> pipelines. They are reference material, not a surface docsxai maintains in
> your repo.

## What execution mode needs

- Node 20+, pnpm, and a Chromium binary
  (`pnpm exec playwright-core install chromium`).
- The doc-pack workspace checked out (flows/, docs/, auth/strategy.yaml,
  `.site-docs.json`) — typically its own repo or a docs/ subdirectory.
- Target-site credentials as CI secrets, exposed under the env-var **names**
  your `auth/strategy.yaml` declares (`creds_env`). The descriptor never
  contains values. Scripted strategies (api-login, jwt-injection, ui-form,
  totp, test-backdoor, …) regenerate the session per run; `manual-capture`
  workspaces are not CI-runnable by design.
- Zero LLM calls, zero agent context: `site-docs run` is deterministic — same
  flows + same target state → byte-identical screenshots (the engine's
  keystone guarantee).

## GitHub Actions

```yaml
name: refresh-docs
on:
  workflow_dispatch:
  schedule: [{ cron: "17 5 * * 1" }] # weekly; or trigger on your app's deploys
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm add -g @kalebtec/docsxai-engine @kalebtec/docsxai-viewer
      - run: pnpm exec playwright-core install chromium
      - name: replay the doc pack
        env:
          APP_EDITOR_USER: ${{ secrets.APP_EDITOR_USER }}
          APP_EDITOR_PASS: ${{ secrets.APP_EDITOR_PASS }}
        run: site-docs run ./docs-workspace --base-url ${{ vars.APP_URL }}
      - name: render + package
        run: |
          site-docs render ./docs-workspace
          site-docs export adf ./docs-workspace
          site-docs zip ./docs-workspace --out doc-pack.zip
      - name: open a PR when screenshots changed
        uses: peter-evans/create-pull-request@v6
        with:
          title: "docs: refreshed screenshots"
          commit-message: "docs: refresh doc pack"
          branch: docs/refresh
```

A halt (non-zero exit) means **drift, not flake**: a locator or success
criterion no longer holds. The failing step id + halt-cause prefix are in the
log and `docs/<flow>/halts/<step>.png` is the moment of failure — hand both to
your calibration agent (`site-docs diagnose`) rather than retrying.

## Drift gating (recommended)

Keep a committed baseline and fail the pipeline only on meaningful change:

```bash
site-docs diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail
# exit 0 = no drift (or warnings only), exit 1 = drift at/above the fail threshold
site-docs baseline ./docs-workspace        # refresh the baseline after an accepted change
```

The markdown report is built for PR comments; the GitHub App's `pr-comment`
strategy posts it automatically.

## GitLab CI

```yaml
refresh-docs:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - corepack enable && corepack prepare pnpm@9 --activate
    - pnpm add -g @kalebtec/docsxai-engine @kalebtec/docsxai-viewer
    - pnpm exec playwright-core install chromium --with-deps
    - site-docs run ./docs-workspace --base-url "$APP_URL"
    - site-docs render ./docs-workspace
    - site-docs zip ./docs-workspace --out doc-pack.zip
  artifacts:
    paths: [doc-pack.zip, docs-workspace/.viewer]
```

## Publishing from CI

- **Wiki push**: configure the workspace's publisher plugin
  (`.site-docs.json` → `plugins` + `plugin_capabilities`) and run the
  publisher after `run` — e.g. `@kalebtec/docsxai-plugin-confluence`
  (`confluence:push`) is idempotent by content-sha, so a no-change run mutates
  nothing. Credentials via env (`CONFLUENCE_TOKEN`, `CONFLUENCE_EMAIL`).
- **Backend persistence**: `SITE_DOCS_TOKEN=… site-docs push ./docs-workspace
--kind run` records the refreshed pack as a finalized revision; run history
  is appended automatically when the workspace is backend-bound.
