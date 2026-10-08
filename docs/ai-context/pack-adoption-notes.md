# Pack adoption notes

What each consumer of the old screenshot scripts does to switch to `docsxai pack` and `docsxai pack --check`. This repo does not edit either consumer. Design and schema: [`screens-pack-decision.md`](screens-pack-decision.md).

Both need, before anything else:

- A docsxai build that has `pack` and `pack --check`. From a checkout: `pnpm -r build`, then run `node <checkout>/packages/engine/dist/cli.js pack ...` with `DOCSX_VIEWER_BIN=<checkout>/packages/viewer/dist/index.js` set (the engine does not find the viewer on its own in a checkout). From an install: the `docsxai` package, once released.
- `oxipng` on PATH (`brew install oxipng`), or `DOCSX_OXIPNG_BIN` pointing at it. Both consumers already require it today (remotxai) or will now (trackxai).

What changes in the output for both: `manifest.json` becomes `docsxai/screens-pack@2`. Callouts are objects (`{ index, copy, bbox? }`), alt is `{ <locale>: text }`, every variant has `bytes`, and `generated_for` is omitted unless `--generated-for` is passed. Any code that reads the old manifest must change; see each section.

The burned numbered badge is filled `#c2410c` now (it was `#e8590c`). Burned PNGs that carry a badge change once, so re-run `pack` and re-record committed baselines after upgrading.

## remotxai (raw capture in, `website/public/screens` out)

Files on `origin/main` at the time of writing. The Playwright capture (`packages/e2e-tests`, `e2e:docs-screens`) already writes the raw contract and needs no change: `<root>/<flow>/<step>/<locale>.<theme>.<viewport>.png` with `.json` sidecar, `step.json`, `flow.json`. Flow and step directory names are kebab-case today, which the new reader accepts (underscores are allowed too).

Delete the whole of `website/scripts/screens/`:

```
build.mjs  build.test.mjs  drift.mjs  drift.test.mjs  manifest-build.mjs  manifest.mjs
manifest.test.mjs  placement.test.mjs  png.mjs  png.test.mjs  raw-input.mjs  run.test.mjs
test-fixtures.mjs  tools.mjs
```

Their jobs now live in `@docsxai/viewer` and have tests there: raw reader (`raw-input.mjs`), validator (`manifest.mjs`, `manifest-build.mjs`), burner loading and oxipng (`tools.mjs`), pixel diff (`png.mjs`, `drift.mjs`), pruning and hashing (`build.mjs`).

Edit `website/package.json`:

```json
"screens": "docsxai pack \"${DOCS_SCREENS_RAW:-../packages/e2e-tests/test-results/docs-screens-raw}\" --from-raw --out public/screens --generated-for \"${REMOTXAI_BUILD_SHA:-unknown}\"",
"screens:drift": "docsxai pack \"${DOCS_SCREENS_RAW:-../packages/e2e-tests/test-results/docs-screens-raw}\" --check --from-raw --against public/screens"
```

The root `docs:screens` and `docs:screens:drift` scripts (`pnpm --filter @remotxai/website ...`) stay. `DOCSXAI_REPO` is no longer read.

Run once: `pnpm docs:screens`, then commit `website/public/screens/manifest.json`. Unchanged images keep their names (same burner, same `oxipng -o 4 --strip safe`, same sha256 prefix), so the PNG diff should be empty unless the burner or `oxipng` changed. The pack removes files the old `manifest.json` (`docsxai/screens-manifest@1`) listed and the new one does not, by exact path.

Things to check:

- Anything that reads `/screens/manifest.json`: `annotations` is now `callouts`, `schema` is `docsxai/screens-pack@2`, every variant has `bytes`. A grep of `website/src` on `origin/main` found no reader; check `docs` content and any component that imports the manifest. There is no v2 to v1 converter, so change the reader.
- The old `build.mjs --check` (committed files only, no capture needed) has no equivalent. `docsxai pack --check` covers a committed file that does not match its name, but needs the raw capture. If CI ran the old `--check` without a capture, keep a small step that runs `validatePack` from `@docsxai/viewer` on `website/public/screens/manifest.json`.
- `generated_for` was `REMOTXAI_BUILD_SHA || "unknown"`; the script above keeps `unknown` as the fallback.
- Optional: the sidecar can now carry `placement` (`inside`, `side`, `align`, `pin_arrow`, `max_width`) next to `arrow_style`, `nudge` and `obstacles`.

## trackxai (workspace in this repo: `workspaces/trackxai-docs`)

The capture side (flows, auth, `pipeline.sh` runs) is unchanged. Steps in `workspaces/trackxai-docs/`:

1. Create `pack.json` from `alt.json` (one logical flow, `app`, fed by both capture flows):

   ```sh
   node -e '
   const alt = JSON.parse(require("fs").readFileSync("alt.json", "utf8"));
   const steps = Object.fromEntries(Object.entries(alt).map(([page, text]) => [page, { alt: { en: text } }]));
   const config = {
     schema: "docsxai/pack-config@1",
     sources: { "desktop-1280": { flow: "app", variant: "en.dark.1280" }, "mobile-390": { flow: "app", variant: "en.dark.390" } },
     flows: { app: { title: { en: "trackxai" }, steps } },
   };
   require("fs").writeFileSync("pack.json", JSON.stringify(config, null, 2) + "\n");
   '
   ```

2. Delete `scripts/build-screens.mjs` and `alt.json` (its text now lives in `pack.json`). `pack` checks that every page has an entry and every entry has a page, and stops on a loopback address or secret in alt or callout text, which is what `build-screens.mjs` did for `127.0.0.1` and `localhost`.
3. In `scripts/pipeline.sh`, replace the last two commands before the retry count (`... viewer ... burn "$W" --report docs/burn-report.json` and `node "$W/scripts/build-screens.mjs" ...`) with:

   ```sh
   export DOCSX_VIEWER_BIN="${DOCSXAI_VIEWER:-$D/packages/viewer/dist/index.js}"
   $DOCSXAI_CLI pack "$W" --out "${1:-$W/.screens}"
   ```

   `pack` burns from the clean screenshots itself, so `docs/<flow>/burned/` is no longer an input. Keep the `burn --report docs/burn-report.json` line only if you still read the placement report to decide which mobile callouts to drop; `pack` also prints how many callouts found no clear spot.

4. Update `README.md` in the workspace: step 4 of the pipeline becomes `docsxai pack` (`docsxai/screens-pack@2`), add `oxipng` to the prerequisites, and remove the `alt.json` and `build-screens.mjs` rows from the table (add `pack.json`).
5. Expect every hash to change on the first run: `pack` now optimises, `build-screens.mjs` did not. Pass `--no-optimise` to keep the old bytes. Files move from `.screens/desktop-1280/` and `.screens/mobile-390/` to `.screens/app/`; the old `.screens/manifest.json` (`docsxai/screens-pack@1`) is read, and the files it listed are removed by exact path.

In the trackxai repo (the site that reads the pack), update the reader once: `screens.<page>.variants[<key>]` becomes `flows.app.steps.<page>.variants[<key>]`, `alt` becomes `alt.en`, each callout is `{ index, copy, bbox }` instead of a string, and `src` is `/screens/app/<page>.<hash8>.png`. A copy of the committed v1 pack can be converted without a recapture:

```js
import { convertScreensPackV1 } from "@docsxai/viewer";
const { pack, moves } = convertScreensPackV1(v1Manifest, { flow: "app" }); // moves: [{ from, to }] under the pack directory
```

Do the file moves in `moves`, then write `serialisePack(pack)` as `manifest.json`.
