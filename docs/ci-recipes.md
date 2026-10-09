# CI recipes — deterministic doc refresh in your pipeline

> The first-class CI surface is the **docsxai GitHub App** (webhook on the
> backend; install-and-go, zero YAML in your repo — see
> `packages/backend/README.md`). The recipes below are the documented
> _examples_ for teams that prefer to drive `docsxai run` from their own
> pipelines. They are reference material, not a surface docsxai maintains in
> your repo.

## What execution mode needs

- Node 26+, pnpm, and a Chromium binary
  (`pnpm exec playwright-core install chromium`).
- The doc-pack workspace checked out (flows/, docs/, auth/strategy.yaml,
  `.docsxai.json`) — typically its own repo or a docs/ subdirectory.
- Target-site credentials as CI secrets, exposed under the env-var **names**
  your `auth/strategy.yaml` declares (`creds_env`). The descriptor never
  contains values. Scripted strategies (api-login, jwt-injection, ui-form,
  totp, test-backdoor, …) regenerate the session per run; `manual-capture`
  workspaces are not CI-runnable by design.
- Zero LLM calls, zero agent context: `docsxai run` is deterministic — same
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
        with: { node-version: 26 }
      - run: pnpm add -g @docsxai/engine@next @docsxai/viewer@next
      - run: pnpm exec playwright-core install chromium
      - name: replay the doc pack
        env:
          APP_EDITOR_USER: ${{ secrets.APP_EDITOR_USER }}
          APP_EDITOR_PASS: ${{ secrets.APP_EDITOR_PASS }}
        run: docsxai run ./docs-workspace --base-url ${{ vars.APP_URL }}
      - name: render + package
        run: |
          docsxai render ./docs-workspace
          docsxai export adf ./docs-workspace
          docsxai zip ./docs-workspace --out doc-pack.zip
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
your calibration agent (`docsxai diagnose`) rather than retrying.

## Drift gating (recommended)

Keep a committed baseline and fail the pipeline only on meaningful change:

```bash
docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail
# exit 0 = no drift (or warnings only), exit 1 = drift at/above the fail threshold
docsxai baseline ./docs-workspace        # refresh the baseline after an accepted change
```

For an unattended nightly version of the same gate, see [Nightly drift jobs](#nightly-drift-jobs).

The markdown report is built for PR comments; the GitHub App's `pr-comment`
strategy posts it automatically.

## GitLab CI

```yaml
refresh-docs:
  image: node:26
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - corepack enable && corepack prepare pnpm@9 --activate
    - pnpm add -g @docsxai/engine@next @docsxai/viewer@next
    - pnpm exec playwright-core install chromium --with-deps
    - docsxai run ./docs-workspace --base-url "$APP_URL"
    - docsxai render ./docs-workspace
    - docsxai zip ./docs-workspace --out doc-pack.zip
  artifacts:
    paths: [doc-pack.zip, docs-workspace/.viewer]
```

## Nightly drift jobs

A nightly job answers two questions: does `docsxai run` still produce the same bytes twice in a
row, and has the app drifted from the committed baseline? Each recipe below does the same four
things: install, `docsxai run --verify-determinism`, `docsxai diff --against <baseline> --fail-on fail`,
and upload the markdown reports as an artifact.

```bash
docsxai run ./docs-workspace --base-url "$APP_URL" --verify-determinism --format md > determinism-report.md
docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail > drift-report.md
```

`--verify-determinism` runs the selected flows 2 times (`--runs <2-5>` for more), each into its own
root under `<workspace>/.docsxai-verify/run-<k>/`, then compares every file byte by byte:
`annotations.json`, the screenshots, the step markdown, the locators and the halt context. The
workspace is only written when all runs agree: run 1's files are copied in, the same bytes a plain
`run` writes. If the runs differ, or a flow halts, the workspace stays as it was, the report names
the first differing artefact with a cause (the JSON key path, the changed-pixel region of a PNG, the
first differing line of a text file, or the sizes), and the exit code is 1. The run roots are removed
when the command ends. The report goes to stdout (`--format text|md|json`), progress to stderr.

A determinism failure means the page, not the engine, changes between two runs of the same flow: a
clock, an animation, a lazy image, a rotating banner. Pin it with the flow's `environment` block
(`clock`, `reduced_motion`), `wait_for: settled`, a `hide` step or a redaction, then run the check
again. Diff only means something once the check passes, which is why the recipes stop at the first
failing step.

`diff` reads only `docs/<flow>/screenshots/` and `docs/<flow>/annotations.json`. A flow with a
`matrix:` writes `docs/<flow>/<variant>/...`, so `diff` reports no screenshot drift for it and
exits 0. In a workspace that uses matrix flows, replace the `diff` line with
`docsxai pack --check --against <pack-dir>` (it needs a `pack.json` in the workspace but no
`oxipng`), and keep the `--verify-determinism` line as it is.

**Do not run browser capture in per-PR pipelines on shared runners.** A capture launches Chromium,
walks the whole app and takes screenshots, so it competes with every other job on the runner for
CPU and memory, and it needs target credentials that a pull request from a fork must never see.
Schedule it (nightly, or on a deploy of the target app) on a runner you control, and keep per-PR
pipelines to the checks that need no browser, such as `docsxai lint` and `docsxai flow-tree`.

The recipes install with `npm install --global docsxai@next` because a plain Node image has npm and nothing else to set up; `pnpm add -g docsxai@next` works the same where pnpm is already on the runner. The pin is `next` because `pack`, `--verify-determinism` and matrix flows are in 0.3.x, which is on the `next` dist-tag while `latest` stays 0.2.0; when 0.3.x ships stable, `latest` moves to it and the pin should move to the stable version. The weekly refresh and GitLab recipes above install the scoped packages with the same `@next` tag, for the same reason: a bare `@docsxai/engine` resolves to 0.2.0 while `latest` is there. Pin the actions by commit SHA in your own repository.

The three files below also live under `examples/ci/` in the docsxai repository, and a test keeps the
copies in this page identical to them.

### GitHub Actions nightly drift (schedule and workflow_dispatch)

<!-- example: examples/ci/github-actions-nightly-drift.yml -->

```yaml
# Nightly drift check for a docsxai doc pack. Copy this file to
# .github/workflows/docsxai-nightly-drift.yml in the repository that holds the workspace.
#
# Schedule and manual runs only. Do not add pull_request or push triggers: browser capture is
# slow and heavy, and per-PR pipelines on shared runners compete for the same CPU and memory.
# The job replays the flows twice into isolated roots (--verify-determinism), then compares the
# result with the committed baseline. Both reports are uploaded as one artifact, also on failure.
# Pinned to docsxai@next, the 0.3.x line; when it ships stable, latest moves and the pin should too.
name: docsxai-nightly-drift

on:
  schedule:
    - cron: "17 3 * * *"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: docsxai-nightly-drift
  cancel-in-progress: false

jobs:
  drift:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 26
      - name: install docsxai and Chromium
        run: |
          npm install --global docsxai@next
          npx playwright-core install --with-deps chromium
      - name: verify determinism
        env:
          APP_URL: ${{ vars.APP_URL }}
          APP_EDITOR_USER: ${{ secrets.APP_EDITOR_USER }}
          APP_EDITOR_PASS: ${{ secrets.APP_EDITOR_PASS }}
        run: docsxai run ./docs-workspace --base-url "$APP_URL" --verify-determinism --format md | tee determinism-report.md
      - name: diff against the baseline
        run: docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail | tee drift-report.md
      - name: upload the reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: docsxai-nightly-reports
          path: |
            determinism-report.md
            drift-report.md
          if-no-files-found: ignore
          retention-days: 30
```

### GitLab CI nightly drift (pipeline schedule)

<!-- example: examples/ci/gitlab-ci-nightly-drift.yml -->

```yaml
# Nightly drift check for a docsxai doc pack. Merge this job into the .gitlab-ci.yml of the
# repository that holds the workspace, then create a pipeline schedule (CI/CD, Schedules) that
# runs it every night. Set APP_URL, APP_EDITOR_USER and APP_EDITOR_PASS as masked CI/CD variables.
#
# The rule below runs the job for scheduled pipelines only. Do not widen it to merge request or
# push pipelines: browser capture is slow and heavy, and per-PR pipelines on shared runners
# compete for the same CPU and memory.
# Pinned to docsxai@next, the 0.3.x line; when it ships stable, latest moves and the pin should too.
docsxai-nightly-drift:
  image: node:26
  timeout: 1h
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - npm install --global docsxai@next
    - npx playwright-core install --with-deps chromium
    - docsxai run ./docs-workspace --base-url "$APP_URL" --verify-determinism --format md > determinism-report.md
    - docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail > drift-report.md
  after_script:
    - cat determinism-report.md drift-report.md || true
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - determinism-report.md
      - drift-report.md
```

### Woodpecker nightly drift (cron)

<!-- example: examples/ci/woodpecker-nightly-drift.yml -->

```yaml
# Nightly drift check for a docsxai doc pack. Copy this file to .woodpecker/docsxai-nightly-drift.yml
# in the repository that holds the workspace, then add a cron named docsxai-nightly-drift under the
# repository's Settings, Crons (for example "0 3 * * *"). Needs Woodpecker 3 for from_secret.
# Add the secrets app_url, app_editor_user, app_editor_pass and, for the upload step, s3_access_key
# and s3_secret_key.
#
# The workflow runs for that cron only. Do not add push or pull_request events: browser capture is
# slow and heavy, and per-PR pipelines on shared runners compete for the same CPU and memory.
# Pinned to docsxai@next, the 0.3.x line; when it ships stable, latest moves and the pin should too.
when:
  - event: cron
    cron: docsxai-nightly-drift

steps:
  - name: drift-check
    image: node:26
    environment:
      APP_URL:
        from_secret: app_url
      APP_EDITOR_USER:
        from_secret: app_editor_user
      APP_EDITOR_PASS:
        from_secret: app_editor_pass
    commands:
      - npm install --global docsxai@next
      - npx playwright-core install --with-deps chromium
      - docsxai run ./docs-workspace --base-url "$APP_URL" --verify-determinism --format md > determinism-report.md
      - docsxai diff ./docs-workspace --against ./docs-workspace/.baseline --format md --fail-on fail > drift-report.md

  - name: show-reports
    image: alpine:3
    when:
      - status: [success, failure]
    commands:
      - cat determinism-report.md drift-report.md || true

  # Woodpecker has no artifact store of its own; this pushes the reports to an S3-compatible bucket.
  - name: upload-reports
    image: woodpeckerci/plugin-s3
    when:
      - status: [success, failure]
    settings:
      bucket: docsxai-reports
      endpoint: https://s3.example.com
      path_style: true
      source: "*-report.md"
      target: nightly/${CI_PIPELINE_NUMBER}/
      access_key:
        from_secret: s3_access_key
      secret_key:
        from_secret: s3_secret_key
```

## Publishing from CI

- **Wiki push**: configure the workspace's publisher plugin
  (`.docsxai.json` → `plugins` + `plugin_capabilities`) and run the
  publisher after `run` — e.g. `@docsxai/plugin-confluence`
  (repo-only, not on npm: wire it by `path` from a checkout; `confluence:push`) is idempotent by content-sha, so a no-change run mutates
  nothing. Credentials via env (`CONFLUENCE_TOKEN`, `CONFLUENCE_EMAIL`).
- **Backend persistence**: `DOCSX_TOKEN=… docsxai push ./docs-workspace
--kind run` records the refreshed pack as a finalized revision; run history
  is appended automatically when the workspace is backend-bound.
