---
title: The doc pack
description: The anatomy of a docsxai workspace - the on-disk layout, what each artifact is for, and the six versioned schemas that make the pack portable and machine-checkable.
---

A doc pack is the complete, portable output of a documented app. It lives in
a workspace directory that is separate from the target app's repo, and every
artifact in it derives deterministically from the flow-files: re-running
re-derives the pack, nothing is hand-retouched, and the whole thing is safe to
commit, `zip`, or `push` to the backend.

## Layout on disk

```
<workspace>/
  flows/<flow>.flow.yaml          flow-file (source of truth for execution)
  docs/<flow>/<step>.md           step write-ups (user-facing prose)
  docs/<flow>/screenshots/<step>.png
  docs/<flow>/annotations.json    per-step annotation records
  docs/<flow>/halts/<step>.png    halt screenshots (debug; excluded from zip)
  docs/style.yaml + style.json    style artifact (canonical + derived)
  docs/locators.yaml              locator manifest (one canonical locator per step)
  auth/strategy.yaml              target-site auth-strategy descriptor
  .auth/                          cached sessions (operator-local, gitignored)
  .viewer/                        rendered viewer (re-derivable, gitignored)
  .baseline/                      drift baseline (commit it; see below)
  .docsxai.json                   workspace config (app_url, plugins, backend binding)
```

## What each artifact does

- **Flow-files** are the source. Everything below them is output. The full
  format is in the [flow-file reference](/reference/flow-file/).
- **Screenshots** are captured clean - no baked annotations - so the same PNG
  serves the interactive viewer, the burn renderer, and pixel-level drift
  comparison. Redactions are applied before the PNG hits disk.
- **`annotations.json`** records, per step, the selector, its bounding box at
  capture time, the callout copy, arrow style, optional nudge offset, and a
  numbered index when one screenshot carries several callouts. The viewer and
  the burn renderer both consume this file; neither re-runs the browser.
- **Step write-ups** are the prose a reader sees next to each screenshot.
  The agent writes them at calibration time; `docsxai style --check` scans
  them for testing jargon that leaked through.
- **The style artifact** pins voice, structure, terminology, and
  `pruning_rules` so every flow's prose reads like one author wrote it.
- **`locators.yaml`** is the cross-flow locator manifest: one canonical
  selector per name, no fallback lists. It is also what `diff` watches for
  locator churn.
- **The auth descriptor** declares per-role auth strategies by env-var name
  only - no secret value ever appears in the pack, which is what keeps the
  pack shareable. See [auth strategies](/reference/auth-strategies/).

## The six versioned schemas

Every machine-readable artifact carries a `schema` id of the form
`docsxai/<name>@<version>`, validated with Zod at every read. Versioned ids
are what let the backend store payloads opaquely and let consumers fail
loudly on shape changes instead of mis-parsing.

**`docsxai/annotations@1`** - the per-flow annotation file: a `flow` name
plus an array of records (`step`, `selector`, `bounding_box`, `copy`,
`arrow_style`, `nudge`, `index`). Bounding boxes are measured at capture
time, so the file is a faithful map of where things were on that exact
screenshot.

**`docsxai/style@1`** - the style artifact: free-form `voice`, `structure`,
`visual`, and `localisation` sections, a `terminology` map, and the
`pruning_rules` list that `style --check` enforces against step write-ups.
Canonical as YAML, rederived as JSON.

**`docsxai/locators@1`** - the locator manifest: flow name to locator name
to canonical selector. One selector per name is a deliberate constraint; the
engine refuses fallback lists because a selector that needs a fallback is a
selector that needs fixing.

**`docsxai/auth-strategy@1`** - the auth descriptor: a `default_role` and a
`roles` map, each role naming a `strategy`, `creds_env` (credential keys to
env-var names), strategy `options`, and a `cache` block (`store: local` or
`backend`, `ttl`, `auth_cookie` expiry pinning).

**`docsxai/drift@1`** - the report `docsxai diff` emits when comparing
the workspace against a baseline: per flow, id-keyed step field deltas,
annotation moves beyond a pixel tolerance, screenshot pixel diffs with
changed-region bounding boxes, prose line-change counts, and locator changes.
The report carries no timestamps - the same two packs always produce a
byte-identical report, which is what makes it safe to gate CI on.

**`docsxai/screenshots@2`** - the screenshot manifest used by backend
transport: file path to `{ sha256, bytes }`. Bytes never travel as
base64-in-JSON; `push` HEAD-probes each blob and uploads only what the
backend lacks, and `pull` verifies every fetched blob against its hash.

## Baselines and drift

After a good run, `docsxai baseline` snapshots the pack into `.baseline/`.
Commit it: it is the "before" that `docsxai diff` compares against, in CI
or locally. Thresholds default to warn at 1% changed pixels and fail at 5%,
with structural changes warning - all tunable through the diff policy on the
library surface.
