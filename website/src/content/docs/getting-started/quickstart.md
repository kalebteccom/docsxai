---
title: Quickstart
description: Scaffold a workspace, capture an authed session if your app needs login, author a first flow-file, run it deterministically, and open the rendered viewer.
---

This page takes you from nothing to a rendered doc pack against your own app.
It assumes `site-docs` is on your PATH ([Installation](/getting-started/installation/))
and your app is running somewhere reachable, say `https://localhost:3000`.

## 1. Scaffold a workspace

A workspace holds everything docsxai produces. Put it **outside** the app's
source repo - docsxai documents a running app from the outside and never
writes into the app's checkout:

```sh
site-docs init ~/site-docs/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h
```

This creates `flows/`, `docs/`, `auth/strategy.yaml`, `.auth/`, `.viewer/`,
and a `.site-docs.json` config holding `app_url`, so later commands need no
flags. Add `--ignore-https-errors` if the app runs on a self-signed dev cert.

## 2. Capture an authed session (skip if the app has no login)

```sh
site-docs capture-auth ~/site-docs/my-app
```

An instrumented Chrome opens. Log in the way you normally would - SSO, MFA,
whatever - then run `window.__siteDocs.capture()` in the devtools console.
The session is cached to `.auth/<role>.json` and `capture-auth` prints the
captured cookie jar. Pin the app's real session cookie so the cache tracks its
true expiry: `site-docs capture-auth ~/site-docs/my-app --auth-cookie session`.
The full auth story, including ten scripted strategies for unattended CI
re-auth, is in [Auth strategies](/reference/auth-strategies/).

## 3. Author a first flow

A flow-file is YAML: named locators, ordered steps, optional waits and
success checks. Write `~/site-docs/my-app/flows/open-reports.flow.yaml`:

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
    annotation: { copy: "Open Reports to see this month's numbers", arrow: top-right }
```

To find good locators on the live, authed page, use
`site-docs inspect ~/site-docs/my-app` - it loads the cached session and
prints the page's `[data-testid]` elements. To author with an agent instead
of by hand, follow the [agent runbook](/guides/agent-runbook/). Before
running, catch authoring mistakes statically:

```sh
site-docs lint ~/site-docs/my-app
```

## 4. Run it

```sh
site-docs run ~/site-docs/my-app --flow open-reports
```

Headless Chromium loads the cached session, replays the steps, and writes
`docs/open-reports/annotations.json` plus a clean screenshot per annotated
step. No agent, no LLM calls; the run halts with a `[cause: ...]` prefix if a
locator or success check fails ([Troubleshooting](/guides/troubleshooting/)).
While iterating on a single step, `run --flow open-reports --stop-after
open-app --pause` keeps the headed browser open mid-flow.

## 5. Render and open the viewer

```sh
site-docs render ~/site-docs/my-app
open ~/site-docs/my-app/.viewer/index.html
```

The viewer index links each flow; every flow page shows the screenshots with
pulsing halos - hover one to read its callout.

## Where to next

- [Agent runbook](/guides/agent-runbook/) - hand calibration to a coding agent end to end.
- [CI recipes](/guides/ci-recipes/) - refresh the pack in your pipeline, gate on drift with `baseline` + `diff`.
- [Flow-file format](/reference/flow-file/) - every field, including `extends`, `environment`, and redactions.
- [The doc pack](/concepts/doc-pack/) - what just landed in your workspace.
