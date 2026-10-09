# Visual captures in CI

`.github/workflows/visual-captures.yml` runs on pull requests that change `website/**`, `packages/viewer/**`, the capture scripts or the workflow. It builds the docs site and renders the sample pack in `examples/ci/sample-repo/docs-workspace/docs` plus an empty pack, opens them in headless Chromium and uploads the PNGs as the `visual-captures` artifact. Nothing is compared and the job never fails on what a picture shows. It fails when a build breaks, a static server cannot start, Chromium cannot launch or not one capture succeeds. A single failed capture is listed in the run summary and the job stays green.

The page list and file names live in `scripts/visual-plan.mjs`, the browser steps in `scripts/visual-capture.mjs`. Playwright comes from `@docsxai/engine`'s `playwright-core`, so the job adds no dependency.

This is not the per-PR browser capture that `docs/ci-recipes.md` warns adopters about: it reads two static builds from this repository, needs no credentials and runs on GitHub-hosted runners.

## Getting the files

1. Open the pull request's Checks tab, then the `visual-captures` run.
2. The run summary lists every PNG by surface, and any capture that failed with its first error line.
3. Download `visual-captures` from the Artifacts section at the bottom of the summary. It is kept for 14 days.

## File names

`<surface>/<state>--<width>--<scheme>.png`, for example `docs/search-open--390--dark.png`. A bottom-of-page capture has `--bottom` at the end of the state, for example `docs/home--bottom--1280--light.png`.

- Widths: 390 (844 tall, mobile and touch emulation, so `pointer: coarse` matches) and 1280 (800 tall).
- Schemes: `light` and `dark`, set through `prefers-color-scheme`. Starlight follows it when no theme is stored; the viewer switches on it.
- Shots marked top of page below start at the top and stop at 2400 px at 390 wide and 1600 px at 1280 wide; a shorter page comes out at its own height. The others are the viewport.
- `docs/wide-table` scrolls the first table that overflows sideways into view (centred under the fixed header, or bottom-aligned when it is taller than the viewport) and takes the viewport, so the table's scrollbar shows. When no table overflows at a width, it shows the first table and the run summary says so.
- `--bottom` shots scroll the page, the sidebar and the table of contents to the end and take the last viewport: footer, previous and next links, the end of the sidebar.
- Reduced motion is on, so the halo pulse and transitions are frozen. Scrollbars are shown (Playwright hides them in headless mode by default).

| File stem                 | Page and state                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| `docs/home`               | `/`, top of page                                                        |
| `docs/home--bottom`       | `/`, last viewport                                                      |
| `docs/skip-link`          | `/` after one Tab: the skip link                                        |
| `docs/skip-link-followed` | `/` after Tab and Enter: where the skip link lands                      |
| `docs/primary-focus`      | `/` with keyboard focus on the first primary button                     |
| `docs/wide-table`         | `/reference/flow-file/`, viewport around the first overflowing table    |
| `docs/wide-table--bottom` | `/reference/flow-file/`, last viewport: footer, prev/next, sidebar end  |
| `docs/404`                | an unknown path, served `404.html` with status 404, top of page         |
| `docs/search-open`        | search dialog with results for "flow"                                   |
| `docs/search-no-results`  | search dialog with a query that matches nothing                         |
| `docs/menu-open`          | `/getting-started/quickstart/` with the mobile menu open, 390 px only   |
| `viewer/index`            | sample pack index, top of page                                          |
| `viewer/flow`             | the `obstacles` flow page, top of page                                  |
| `viewer/flow--bottom`     | the `obstacles` flow page, last viewport                                |
| `viewer/focused-step`     | flow page after `→` and Tab: step 1 focused, its first call-out showing |
| `viewer/error`            | flow page with every screenshot request aborted: the error line, Retry  |
| `viewer/empty`            | index of a pack with no flows, top of page                              |

The plan has 66 PNGs: 42 docs and 24 viewer.

To add a page or state, add an entry to `SHOTS` in `scripts/visual-plan.mjs` and, if it needs one, an action in `ACTIONS` in `scripts/visual-capture.mjs`. Set `capture` to `top` for a page capture and `bottom: true` for a long page whose end needs a look. `scripts/visual-plan.test.mjs` runs first in the job.

## What the screenshots cover

Against the browser checks listed in `docs-site-audit.md` and `viewer-audit.md`:

| Check                                                    | Covered by                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Skip link on `/`, and the hero first in view after it    | `docs/skip-link`, `docs/skip-link-followed`                         |
| Focus ring on the primary button, both themes            | `docs/primary-focus`                                                |
| Sidebar on desktop and in the mobile menu                | every 1280 `docs/*` shot, `docs/menu-open`                          |
| Footer, previous and next links, end of the sidebar      | `docs/wide-table--bottom`; the splash footer in `docs/home--bottom` |
| 44 px targets under `pointer: coarse`                    | the 390 shots (emulated touch)                                      |
| Pagefind empty state wording                             | `docs/search-no-results`                                            |
| Scrollbars on a table and in the search dialog, Chromium | `docs/wide-table`, `docs/search-open`                               |
| Callout shown on focus                                   | `viewer/focused-step`                                               |
| Dark scheme of every viewer page part                    | the `--dark` viewer shots                                           |
| Empty, error and Retry states                            | `viewer/empty`, `viewer/error`                                      |
| Diagram text on a phone                                  | not captured; the diagram page is not in the plan yet               |
| Skip link on `/404.html`                                 | `docs/404` shows the page, not the skip link after Tab              |
| A collapsed sidebar group stored from an earlier session | not captured                                                        |

Still needs a person:

- Safari and Firefox, including Retry on `file://` in Safari and the callout on tap in iOS Safari.
- Forced colours and `prefers-contrast: more` (the scrollbar reset to `auto`, focus rings).
- A real touch device: tap targets under a finger, overlay redraw after rotation.
- Screen readers: live-region announcements in VoiceOver and NVDA.
- Layout shift on load (CLS from the font swap and the reserved image boxes), and print preview.
