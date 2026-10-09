# Visual captures

The `visual-captures` GitHub Actions workflow was retired when CI moved to Woodpecker, so no pipeline takes these screenshots today. The scripts stay in the repository and do not depend on a CI runner, so a Woodpecker step can run them later. The Woodpecker `architecture` step runs `scripts/visual-plan.test.mjs`.

The scripts build nothing themselves. Given a built docs site, a rendered sample pack (`examples/ci/sample-repo/docs-workspace/docs`) and an empty pack, they open each in headless Chromium and write PNGs plus a markdown summary. Nothing is compared. A run fails when a static server cannot start, Chromium cannot launch or not one capture succeeds. A single failed capture is listed in the summary and the run still exits 0.

The page list and file names live in `scripts/visual-plan.mjs`, the browser steps in `scripts/visual-capture.mjs`. Playwright comes from `@docsxai/engine`'s `playwright-core`, so the scripts add no dependency.

This is not the per-PR browser capture that `docs/ci-recipes.md` warns adopters about: it reads two static builds from this repository and needs no credentials.

## Running the captures

```bash
pnpm --filter @docsxai/viewer build
pnpm --filter @docsxai/website build
pnpm -C packages/engine exec playwright-core install chromium
mkdir -p /tmp/empty-docs
node packages/viewer/dist/index.js build examples/ci/sample-repo/docs-workspace/docs /tmp/viewer
node packages/viewer/dist/index.js build /tmp/empty-docs /tmp/viewer-empty
node scripts/visual-capture.mjs --site website/dist --viewer /tmp/viewer \
  --empty /tmp/viewer-empty --out /tmp/visual --summary /tmp/visual-summary.md
```

The summary lists every PNG by surface, and any capture that failed with its first error line.

## File names

`<surface>/<state>--<width>--<scheme>.png`, for example `docs/search-open--390--dark.png`.

- Widths: 390 (844 tall, mobile and touch emulation, so `pointer: coarse` matches) and 1280 (800 tall).
- Schemes: `light` and `dark`, set through `prefers-color-scheme`. Starlight follows it when no theme is stored; the viewer switches on it.
- Shots marked full page below are the whole page; the others are the viewport.
- Reduced motion is on, so the halo pulse and transitions are frozen. Scrollbars are shown (Playwright hides them in headless mode by default).

| File stem                 | Page and state                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| `docs/home`               | `/`, full page                                                          |
| `docs/skip-link`          | `/` after one Tab: the skip link                                        |
| `docs/skip-link-followed` | `/` after Tab and Enter: where the skip link lands                      |
| `docs/primary-focus`      | `/` with keyboard focus on the first primary button                     |
| `docs/wide-table`         | `/reference/flow-file/`, full page, wide tables                         |
| `docs/404`                | an unknown path, served `404.html` with status 404, full page           |
| `docs/search-open`        | search dialog with results for "flow"                                   |
| `docs/search-no-results`  | search dialog with a query that matches nothing                         |
| `docs/menu-open`          | `/getting-started/quickstart/` with the mobile menu open, 390 px only   |
| `viewer/index`            | sample pack index, full page                                            |
| `viewer/flow`             | the `obstacles` flow page, full page                                    |
| `viewer/focused-step`     | flow page after `→` and Tab: step 1 focused, its first call-out showing |
| `viewer/error`            | flow page with every screenshot request aborted: the error line, Retry  |
| `viewer/empty`            | index of a pack with no flows                                           |

To add a page or state, add an entry to `SHOTS` in `scripts/visual-plan.mjs` and, if it needs one, an action in `ACTIONS` in `scripts/visual-capture.mjs`. `scripts/visual-plan.test.mjs` checks the plan and runs in the Woodpecker `architecture` step.

## What the screenshots cover

Against the browser checks listed in `docs-site-audit.md` and `viewer-audit.md`:

| Check                                                    | Covered by                                             |
| -------------------------------------------------------- | ------------------------------------------------------ |
| Skip link on `/`, and the hero first in view after it    | `docs/skip-link`, `docs/skip-link-followed`            |
| Focus ring on the primary button, both themes            | `docs/primary-focus`                                   |
| Sidebar on desktop and in the mobile menu                | every 1280 `docs/*` shot, `docs/menu-open`             |
| 44 px targets under `pointer: coarse`                    | the 390 shots (emulated touch)                         |
| Pagefind empty state wording                             | `docs/search-no-results`                               |
| Scrollbars on a table and in the search dialog, Chromium | `docs/wide-table`, `docs/search-open`                  |
| Callout shown on focus                                   | `viewer/focused-step`                                  |
| Dark scheme of every viewer page part                    | the `--dark` viewer shots                              |
| Empty, error and Retry states                            | `viewer/empty`, `viewer/error`                         |
| Diagram text on a phone                                  | not captured; the diagram page is not in the plan yet  |
| Skip link on `/404.html`                                 | `docs/404` shows the page, not the skip link after Tab |
| A collapsed sidebar group stored from an earlier session | not captured                                           |

Still needs a person:

- Safari and Firefox, including Retry on `file://` in Safari and the callout on tap in iOS Safari.
- Forced colours and `prefers-contrast: more` (the scrollbar reset to `auto`, focus rings).
- A real touch device: tap targets under a finger, overlay redraw after rotation.
- Screen readers: live-region announcements in VoiceOver and NVDA.
- Layout shift on load (CLS from the font swap and the reserved image boxes), and print preview.
