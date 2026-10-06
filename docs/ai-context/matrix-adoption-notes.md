# Matrix adoption notes

How `workspaces/trackxai-docs` would collapse its two flows into one with `matrix:`, and what a locale and theme matrix looks like for a harness that varies them by hand. Nothing here is migrated: the trackxai and remotxai repos and the workspace's flows stay as they are until someone decides to switch. Design: [`architecture/flow-matrix-decision.md`](architecture/flow-matrix-decision.md).

## What differs between the two trackxai flows

`desktop-1280.flow.yaml` has 560 lines and `mobile-390.flow.yaml` 500. Both run the same 16 pages with the same step ids in the same order, and share `environment` except `viewport`. A diff shows four kinds of difference, and none of them is a step that exists on one viewport only:

| Kind                                            | Count in the diff                                                                                                                                                                              | Matrix tool                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `viewport` in `environment`                     | 1                                                                                                                                                                                              | `matrix.viewports`                   |
| Locators that only one flow defines             | 16 desktop-only, 1 mobile-only (`assignment_chip`)                                                                                                                                             | the union goes in one `locators` map |
| Annotations on one viewport only                | 17 desktop-only (`view_tabs`, `col_progress_head`, `palette_list`, `ticket_acts`, `ticket_gaps`, `col_head`, `tab_backlog`, `group_progress`, `epic_holders_first`, and 8 more), 3 mobile-only | `only:` / `skip:` on the annotation  |
| Same target, different copy, arrow or placement | 6 (`epic_status`, `progress_row_first`, `doc_title`, `tokens_config`, `tokens_agent_cell`, `settings_key_input`)                                                                               | two annotations with `only:` on each |

Step-level `only` / `skip` is not needed: every step exists on both viewports.

## The merged flow

```yaml
name: tour
environment:
  clock: 2026-01-15T10:00:00Z
  locale: en-US
  timezone: UTC
  color_scheme: dark
  reduced_motion: true
matrix:
  viewports:
    - { name: desktop-1280, width: 1280, height: 800 }
    - { name: mobile-390, width: 390, height: 844 }
locators:
  # the union of both files; the 16 desktop-only names and assignment_chip sit side by side
  page_title: h1.page__title
  view_tabs: nav.etabs
  assignment_chip: div.qbar--assignment button.chip
  # ...
steps:
  - id: board-open
    action: navigate
    value: /w/acme-demo/board
    wait_for:
      selector: $col_progress
  # board-idle, board-no-dev-overlay, board-no-loopback: unchanged, written once
  - id: board
    action: wait
    target: $page_title
    wait_for: settled
    annotations:
      - target: $page_title
        copy: The board shows every task as a card, grouped by status.
        arrow: right
      - target: $view_tabs
        copy: Switch between the board, the backlog and the full list.
        arrow: bottom
        only: { viewport: [desktop-1280] }
      - target: $col_progress_head
        copy: Tasks an agent is working on right now sit in In progress.
        arrow: top
        placement: { side: top, align: end }
        only: { viewport: [desktop-1280] }
  # ...
  - id: list
    action: wait
    target: $page_title
    wait_for: settled
    annotations:
      - target: $filters
        copy: Filter the list, or add a filter on any field.
        arrow: bottom
      - target: $col_head
        copy: Columns show gaps, epic, criteria and estimate for every task.
        arrow: top
        only: { viewport: [desktop-1280] }
      - target: $assignment_chip
        copy: Narrow the list by who holds each task.
        arrow: bottom
        only: { viewport: [mobile-390] }
      - target: $list_gap_btn
        copy: A gap count means an agent is waiting on you. Open it to answer.
        arrow: left
  # ...
  - id: agent-tokens-issued
    action: wait
    target: $tokens_table_head
    wait_for: settled
    annotations:
      - target: $tokens_form_input
        copy: Name a token for one agent session, then issue it.
        arrow: right
        only: { viewport: [desktop-1280] }
      - target: $tokens_agent_cell # same target, two shapes
        copy: Each token belongs to one agent, so every write says which agent made it.
        arrow: top
        nudge: { x: 0, y: 5 }
        placement: { side: top, max_width: 560, pin_arrow: true }
        only: { viewport: [desktop-1280] }
      - target: $tokens_agent_cell
        copy: Each token belongs to one agent.
        arrow: bottom
        placement: { side: bottom, max_width: 260 }
        only: { viewport: [mobile-390] }
```

Estimate: about 600 lines, down from 1,060. A step's navigation, idle, dev-overlay and loopback guards exist once. A new page is added once and cannot drift between viewports.

`docsxai lint` then prints `R015 [info] matrix expands to 2 variants: desktop-1280, mobile-390`, and R006 still counts a locator as used when any step references it.

## What changes outside the flow

- Variant ids are the viewport names, so output moves from `docs/desktop-1280/` and `docs/mobile-390/` to `docs/tour/desktop-1280/` and `docs/tour/mobile-390/` (`screenshots/`, `annotations.json`, `halts/`, and `burned/` after `burn`).
- `scripts/pipeline.sh` runs `docsxai run` once per page with `--start-from` and `--stop-after`. Each flag still works per variant, and merging by step id happens inside each variant's `annotations.json`. `docsxai run --flow tour --variant mobile-390` repeats one viewport. The page segmentation in `flow-segments.mjs` reads the flow file, so it has to read `tour.flow.yaml` once and apply the segments to both variants.
- `docsxai-viewer burn --report` lists flows as `tour/desktop-1280` and `tour/mobile-390`. `build-screens.mjs` reads `docs/<flow>/burned/<step>.png` today; it needs the extra path segment, and the manifest's per-viewport grouping can use the variant id directly.
- The 8-attempt retry loop for a page that halts on the dev badge is unchanged. A halt now reads `[variant mobile-390] step "board-no-dev-overlay" ...`, so the loop knows which viewport to repeat.
- Decide the axes up front. Variant ids only contain axes the matrix names. A matrix of just `viewports` gives `desktop-1280`; adding `color_schemes: [dark, light]` later renames the directories to `dark.desktop-1280`. If a light theme is likely, put `color_schemes: [dark]` in the matrix now.
- The mobile flow drops a callout when `burn --report` marks it unplaceable. In the merged file that is an `only: { viewport: [desktop-1280] }` on the annotation, with the reason in a comment next to it.

Before switching, run the old pair and the merged flow against the same demo state and compare `.screens/` per viewport. The screenshots of each viewport should be byte-identical to the old ones apart from the moved path, since the engine reaches the same steps and environment. `annotations.json` differs in two fields: `flow` is `tour`, and a `variant` object follows it.

## remotxai

The harness varies locale and theme by hand, so the flow can state both:

```yaml
matrix:
  locales: [en-US, es-ES]
  color_schemes: [light, dark]
steps:
  - id: dashboard
    action: wait
    target: $page_title
    annotation:
      copy: Your agents and their sessions are listed here.
      copy_by_locale: { es: Tus agentes y sus sesiones aparecen aqui. }
```

That is 4 variants (`en-US.light`, `en-US.dark`, `es-ES.light`, `es-ES.dark`) from one file. `copy_by_locale` takes the exact locale first (`es-ES`), then the language (`es`), then `copy`. If the app translates its own UI from the browser locale, `locales` also changes the screenshot text without any flow step. If the app takes the language from a setting or a cookie, a locale matrix does not switch it: add a step guarded by `only: { locale: [es] }` that selects the language, and leave the matrix to drive the callout copy and `Accept-Language`.
