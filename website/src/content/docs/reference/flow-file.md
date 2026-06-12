---
title: Flow-file format
description: The complete field-by-field reference for flows/<name>.flow.yaml - top-level keys, every step field, the action vocabulary, wait and success forms, annotations, environment, redactions, and extends merge semantics.
---

A flow-file (`flows/<name>.flow.yaml`) is the YAML description of one user
journey and the source of truth for execution. It is Zod-validated on every
parse; unknown keys are rejected, so a typo fails loudly instead of being
ignored. This page covers every field.

## Top-level keys

| Key             | Required | What it is                                                                                                                                                                                                                          |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | yes      | The flow's name. Output lands under `docs/<name>/`.                                                                                                                                                                                 |
| `extends`       | no       | Name of another flow whose steps run _first_. See [merge semantics](#extends-merge-semantics).                                                                                                                                      |
| `environment`   | no       | Deterministic execution environment. See [environment](#environment).                                                                                                                                                               |
| `redactions`    | no       | Areas masked on every screenshot this flow produces, halt shots included.                                                                                                                                                           |
| `prerequisites` | no       | Preconditions the flow assumes, as a list of `{ key: value }` records (string or boolean values), e.g. `{ logged_in_as: editor }` or `{ feature_flag: "recap.enabled" }`. Documentation for the reader and the agent; not executed. |
| `locators`      | no       | Named canonical locators, referenced from steps as `$name`. One selector per name; no fallback lists.                                                                                                                               |
| `steps`         | yes      | The ordered step list (at least one).                                                                                                                                                                                               |

## Steps

Every step:

| Field         | Required | What it is                                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Unique step id (unique across the whole `extends` merge). Names the screenshot, the write-up, and the halt artifacts.                                                                                                                                                                                                                                   |
| `action`      | yes      | One of the [action types](#action-types).                                                                                                                                                                                                                                                                                                               |
| `optional`    | no       | Best-effort step: if the action, `wait_for`, or `success` throws, skip and continue instead of halting. For conditionally-present UI - a confirm modal that sometimes appears, a first-run tooltip, a cookie banner. A skipped optional step emits no screenshot or annotation. Prefer this over a permissive comma-selector that no-ops on one branch. |
| `target`      | no       | Locator ref (`$name`) or inline selector. Optional for actions like `navigate` (which uses `value`) or `wait`.                                                                                                                                                                                                                                          |
| `value`       | no       | The action payload: text for `fill`, file path for `upload`, key for `press`, path or URL for `navigate`, option for `select`.                                                                                                                                                                                                                          |
| `wait_for`    | no       | What to wait for after the action settles. See [wait forms](#wait_for-forms).                                                                                                                                                                                                                                                                           |
| `success`     | no       | Post-step success criterion. Execution halts if it fails - no selector fallbacks; drift is a signal. See [success forms](#success-forms).                                                                                                                                                                                                               |
| `annotation`  | no       | A single callout on this step's screenshot. Shorthand for a one-element `annotations` array.                                                                                                                                                                                                                                                            |
| `annotations` | no       | Multiple callouts on the same screenshot, rendered as numbered badges (1, 2, ...). Mutually exclusive with `annotation`.                                                                                                                                                                                                                                |
| `redactions`  | no       | Extra redactions for this step's screenshots, additive on top of the flow-level list.                                                                                                                                                                                                                                                                   |

### Action types

`navigate`, `click`, `fill`, `upload`, `press`, `hover`, `select`, `check`,
`uncheck`, `wait`.

- `navigate` takes `value` (a path resolved against the workspace's
  `app_url`, or an absolute URL) - not `target`.
- `click`, `hover`, `check`, `uncheck` take `target`.
- `fill`, `select`, `upload` take `target` plus `value`.
- `press` takes `value` (the key); `target` is optional (focused element when
  absent).
- `wait` is a bare step that just runs its `wait_for`.

### `wait_for` forms

```yaml
wait_for: network_idle                              # named primitive
wait_for: load                                      # named primitive
wait_for: element_stable                            # polls the step target's bounding box until stable (10s budget)
wait_for: { selector: $done_marker }                # wait for an element to appear (~30s default)
wait_for: { selector: $done_marker, timeout_ms: 180000 }  # per-step override for slow backend ops
wait_for: { timeout_ms: 800 }                       # blind sleep - last resort, for animations, not state
```

`element_stable` needs a step `target` to watch; without one it waits on
nothing (lint rule R009). The selector form takes a locator ref or inline
selector; `timeout_ms` is the override for multi-minute backend operations.

### `success` forms

```yaml
success: { visible: $recap_panel }                                  # element is visible
success: { hidden: $spinner }                                       # no visible match
success: { url_matches: "/dashboard/reports" }                      # current URL matches the regex
success: { text_contains: { selector: $status, text: "Published" } }  # element text contains
```

A failed `success` halts the run with the actual state in the message (the
current URL, how many elements matched, the actual text). Prefer
`text_contains` on content that only appears in the target state over
structural selectors that may match stale or hidden poppers.

### Annotations

`StepAnnotation`, used by both `annotation` and `annotations[]`:

| Field    | Required | What it is                                                                                                                                                                                                                                         |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy`   | yes      | The callout text the reader sees.                                                                                                                                                                                                                  |
| `arrow`  | no       | Arrow placement: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top`, `bottom`, `left`, `right`.                                                                                                                                         |
| `nudge`  | no       | `{ x, y }` pixel offset applied to the callout and arrow after placement; the halo stays on the target. Use it when two callouts on one screenshot would overlap - small values (5 to 40 px) typically suffice.                                    |
| `target` | no       | Override: the locator to anchor the halo and arrow to. Default is the step's `target`. Use this when the step's action _transitions the UI_ - the action target unmounts, and you want to highlight an element that exists in the resulting state. |

With `annotations:` (plural), each entry gets a 1-based numbered badge so the
reader sees up front that there is more than one thing to look at.

## Environment

All fields optional; applied at browser-context creation, so the whole flow
runs under them. This block is what makes replays byte-identical:

```yaml
environment:
  clock: "2030-01-02T03:04:05Z" # freeze the page clock at this ISO-8601 instant
  locale: en-GB # BCP-47 language tag
  timezone: Europe/Amsterdam # IANA timezone
  viewport: desktop # preset or { width: W, height: H }
  color_scheme: dark # light | dark
  reduced_motion: true
```

Viewport presets: `desktop` is 1440x900, `tablet` is 834x1112, `mobile` is
390x844. With `extends`, `environment` merges per-key and the child flow
wins - a child can pin just `viewport` for a responsive variant and inherit
the parent's clock, or override just `locale` for a locale replay. On
CDP-attached runs the attached Chrome owns its context, so only the clock
applies; the engine logs one stderr warning listing the skipped fields.

## Redactions

Flow-level `redactions` apply to every screenshot the flow produces - halt
shots included; per-step `redactions` are additive. Masks are applied before
any pixel hits disk, with deterministic fills, so they never break
reproducibility:

```yaml
redactions:
  - { selector: $api_key_field } # element's bounding box at capture time
  - { selector: $billing_total, style: pixelate } # 16-px mosaic instead of the default solid box
  - { region: { x: 10, y: 80, width: 220, height: 40 } } # fixed rect in CSS pixels
```

`style` is `box` (solid black, the default) or `pixelate`. A selector that
matches nothing at capture time is skipped with a stderr warning - redacting
an absent element is vacuously satisfied, never a halt. An annotation
anchored to a redacted element would point at a black box; lint rule R010
flags that.

## `extends` merge semantics

`extends: <name>` names another flow whose steps run _first_ (resolved at run
time against `flows/<name>.flow.yaml`). The merge rules:

- The parent's `locators` and `prerequisites` are merged in; this flow wins
  on name collisions.
- Step ids must be unique across the merge; collisions are a resolution
  error.
- `environment` merges per-key, child wins. `redactions` concatenate
  (parent's plus this flow's).
- Chains are allowed (A extends B extends C); cycles are rejected.
- `run --stop-after` operates on the merged step list, so it can target a
  parent step too.

The typical use is a shared preamble: put the multi-step "get to the right
place" walk in its own flow with no annotations, and have each dependent flow
start with `extends: preamble`. The un-annotated parent adds zero doc noise,
and iterating on a child's steps stays cheap.

## A complete annotated example

```yaml
name: publish-post
extends: login # the login flow's steps run first
environment:
  clock: "2030-01-02T03:04:05Z"
  viewport: desktop
  color_scheme: light
redactions:
  - { selector: $account_email } # masked on every screenshot, halt shots included
prerequisites:
  - { logged_in_as: editor }
locators:
  new_post: '[data-testid="new-post"]:visible'
  editor_body: '[data-testid="editor-body"]'
  publish_button: '[data-testid="publish"]'
  live_banner: '[data-testid="live-banner"]'
  confirm_ok: '[data-testid="confirm-ok"]'
  account_email: '[data-testid="account-email"]'
steps:
  - id: open-editor
    action: click
    target: $new_post
    wait_for: { selector: $editor_body }
    success: { visible: $editor_body }
    annotation: { copy: "Start a new post from anywhere", arrow: top-right }

  - id: write-draft
    action: fill
    target: $editor_body
    value: "Release notes, June"
    wait_for: element_stable

  - id: publish
    action: click
    target: $publish_button
    wait_for: { selector: $live_banner, timeout_ms: 120000 } # publishing is a slow backend op
    success: { visible: $live_banner }
    annotations: # two numbered callouts on one screenshot
      - {
          copy: "Publish ships the post",
          target: $publish_button,
          arrow: top,
          nudge: { x: -30, y: 0 },
        }
      - { copy: "The live banner confirms it", target: $live_banner, arrow: left }

  - id: dismiss-confirm
    action: click
    target: $confirm_ok
    optional: true # the modal only appears sometimes
    wait_for: { selector: $confirm_ok }

  - id: confirm-live
    action: navigate
    value: /posts
    wait_for: load
    success: { text_contains: { selector: "body", text: "Release notes, June" } }
```

Validate with `docsxai lint`, visualise the `extends` graph with
`docsxai flow-tree`, and see [Troubleshooting](/guides/troubleshooting/)
when a step halts.
