---
title: Quickstart
description: Install docsxai, scaffold a workspace, capture an authed session if your app needs login, author a first flow-file, run it deterministically, and open the rendered viewer.
next:
  link: /reference/flow-file/
  label: Flow-file format
---

This page takes you from nothing to a rendered doc pack against your own app,
running somewhere reachable, say `http://localhost:3000`. To try it first
without an app, finish step 1, then three commands document `example.com`:

```sh
docsxai init ~/docsxai/hello --example
docsxai run ~/docsxai/hello
docsxai render ~/docsxai/hello --open
```

Three terms. A **flow** is a YAML file listing the steps of one user task.
To **add a flow** is to write it the first time, by hand or with an AI
agent, and put it in the workspace with `docsxai add-flow` (formerly `calibrate`). The **doc pack** is what a run writes into your workspace: annotations
and screenshots per flow.

## 1. Install

```sh
npm install -g docsxai@next
npx playwright-core install chromium
docsxai doctor
```

`@next` is the current prerelease. It needs Node 26 or newer. Chromium is a
separate download, and `doctor` checks both. For pnpm or a source checkout, see
[Installation](/getting-started/installation/).

## 2. Scaffold a workspace

A workspace holds everything docsxai produces. Put it **outside** the app's
source repo - docsxai documents a running app from the outside and never
writes into the app's checkout:

```sh
docsxai init ~/docsxai/my-app --app-url http://localhost:3000 --auth manual-capture --ttl 1h
```

`--auth manual-capture` means you log in by hand once in step 3. `--ttl 1h` is
the fallback expiry of that cached session. If the app has no login, use
`--auth none` instead and skip step 3.

The command prints `init: workspace at <dir>`, the list of what it created, and
a `next:` line with the follow-up commands. It creates `flows/`, `docs/`,
`auth/strategy.yaml`, `.auth/`, `.viewer/`, and a `.docsxai.json` config
holding `app_url`, so later commands need no flags. Add `--ignore-https-errors`
if the app runs on a self-signed dev cert.

## 3. Capture an authed session (skip if the app has no login)

```sh
docsxai capture-auth ~/docsxai/my-app
```

An instrumented Chrome opens. Log in the way you normally would - SSO, MFA,
whatever - then run `window.__docsxai.capture()` in the devtools console.
The session is cached to `.auth/<role>.json` and `capture-auth` prints the
captured cookie jar. Pin the app's real session cookie so the cache tracks its
true expiry: `docsxai capture-auth ~/docsxai/my-app --auth-cookie session`.
The full auth story, including ten scripted strategies for unattended CI
re-auth, is in [Auth strategies](/reference/auth-strategies/).

## 4. Author a first flow

A flow-file is YAML: named locators, ordered steps, optional waits and
success checks. `init` left a commented example in
`flows/example.flow.yaml.sample`, which `run` ignores until
`docsxai add-flow ~/docsxai/my-app --from ~/docsxai/my-app/flows/example.flow.yaml.sample`
turns it into `flows/example.flow.yaml`. For your own first flow, write
`~/docsxai/my-app/flows/open-reports.flow.yaml`:

```yaml
name: open-reports
locators:
  nav_reports: '[data-testid="nav-reports"]'
  report_table: '[data-testid="report-table"]'
steps:
  - id: open-app
    action: navigate
    value: /dashboard
    wait_for: load
  - id: open-reports
    action: click
    target: $nav_reports
    wait_for: { selector: $report_table }
    success: { visible: $report_table }
    annotation:
      target: $nav_reports
      copy: "Open Reports to see this month's numbers"
      arrow: top-right
```

To find good locators on the live, authed page, use
`docsxai inspect ~/docsxai/my-app` - it loads the cached session and
prints the page's `[data-testid]` elements. To author with an agent instead
of by hand, follow the [agent runbook](https://github.com/kalebteccom/docsxai/blob/main/docs/agent-runbook.md). Before
running, catch authoring mistakes statically:

```sh
docsxai lint ~/docsxai/my-app
```

## 5. Run it

```sh
docsxai run ~/docsxai/my-app --flow open-reports
```

Headless Chromium loads the cached session, replays the steps, and writes
`docs/open-reports/annotations.json` plus a clean screenshot per annotated
step. A successful run prints a starting line and a result line per flow:

```text
run: open-reports, starting
run: open-reports, 2 step(s) executed, 1 annotation(s) written
```

The last line is a summary, for example
`run: 1 of 1 flow ok, outputs in ~/docsxai/my-app/docs`.

No agent, no LLM calls. If a locator or success check fails, the run halts with
the cause in square brackets and prints a `next:` line naming the command to run
([Troubleshooting](/guides/troubleshooting/)). While iterating on a single step,
`run --flow open-reports --stop-after open-app --pause` keeps the headed
browser open mid-flow.

## 6. Render and open the viewer

```sh
docsxai render ~/docsxai/my-app
open ~/docsxai/my-app/.viewer/index.html
```

`render` prints the path to open, as `render: open <path>/.viewer/index.html`.
`open` is the macOS command; on Linux use `xdg-open`, on Windows `start`. The
viewer index links each flow; every flow page shows the screenshots with
pulsing halos. Hover, tap or tab to a halo to read its callout.

Add `--lang es` for Spanish page text. For a docs site you can host, run
`docsxai site ~/docsxai/my-app --build`. It writes an Astro Starlight project to
`~/docsxai/my-app/site` and builds it into `site/dist`.

## Where to next

- [Agent runbook](https://github.com/kalebteccom/docsxai/blob/main/docs/agent-runbook.md) - hand calibration to a coding agent end to end.
- [CI recipes](/guides/ci-recipes/) - refresh the pack in your pipeline, gate on drift with `baseline` + `diff`.
- [Flow-file format](/reference/flow-file/) - every field, including `extends`, `environment`, and redactions.
- [The doc pack](/concepts/doc-pack/) - what just landed in your workspace.
