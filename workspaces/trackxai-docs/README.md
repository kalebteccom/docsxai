# trackxai docs workspace

A docsxai workspace that documents trackxai. It walks the seeded demo target (Acme Demo, loopback only), captures 16 pages at two viewports and packs them as hashed PNGs with a manifest.

| Folder or file       | What it holds                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| `flows/`             | One flow per viewport: `desktop-1280` (1280x800) and `mobile-390` (390x844)   |
| `auth/strategy.yaml` | Signs in as Ana through the demo login route (loopback only, no secret)       |
| `alt.json`           | One English alt text per page, copied into the manifest                       |
| `.docsxai.json`      | Workspace config: demo URL and `annotations.obstacles` so callouts avoid text |
| `scripts/`           | `pipeline.sh`, `flow-segments.mjs`, `build-screens.mjs`                       |
| `docs/`, `.screens/` | Generated output, ignored by git (also `.auth/` and `.viewer/`)               |

The demo serves `http://127.0.0.1:3100/mcp` in the MCP configuration block on `agent-tokens` and `agent-tokens-issued`, and in the connector URL box on `connect`. The docs are public, so a flow hides that text (`hide` on the `code` or `pre` inside the block) and the boxes show blank. The copy button and the box stay in place. The real endpoint is `https://trackxai.kalebtec.com/mcp`. A redaction can only box or pixelate, it cannot print other text, so the flows do not show it.

Every page has a `<page>-no-loopback` step before its capture. It halts the run when `127.0.0.1` or `localhost` is visible in the page text (or in an input value or placeholder), after any `hide`. `pipeline.sh` stops on that halt at once, with no retries. `build-screens.mjs` checks the callouts and alt texts for the same strings.

Both flows run English, dark, `en-US`, UTC, reduced motion, with the browser clock pinned to the demo clock (`2026-01-15T10:00:00Z`).

Pages, per viewport: board, palette (command palette), ticket (WEB-8), waiting (waiting on you), list, backlog, epics, epic (checkout redesign), progress, documents, document (checkout redesign brief), mine (leading tab), settings, agent-tokens, agent-tokens-issued (the token table, scrolled into view) and connect. Each has 1 to 3 callouts. The mobile flow shows fewer callouts: a 280 px callout over a 390 px page has no free spot on most pages, so only the callouts that land clear of text are kept, and the target is also left out where it is hidden or off screen.

## Start the demo target

From a throwaway clone of trackxai, never the working repo or any real account:

```sh
git clone --depth 1 <trackxai remote> trackxai-demo-run && cd trackxai-demo-run
pnpm install --frozen-lockfile && pnpm exec tsc --build
PG_BIN=/opt/homebrew/opt/postgresql@18/bin scripts/demo/start.sh   # http://127.0.0.1:3100
```

trackxai main sets `devIndicators: false` in `apps/web/next.config.mjs`. A clone from before that commit needs the same line in `nextConfig`, or the Next dev badge shows on every load and the `*-no-dev-overlay` guard halts every page. If the badge still shows on a load, `pipeline.sh` retries it.

Stop it when done: `scripts/demo/start.sh stop --clean-build`. One demo instance at a time.

## Run

```sh
export DOCSXAI=<path to a docsxai checkout, built with pnpm -r build>
cd workspaces/trackxai-docs
sh scripts/pipeline.sh            # packs into .screens/
sh scripts/pipeline.sh /some/dir  # packs somewhere else
```

Set `DOCSXAI_VIEWER=<path to a viewer dist/index.js>` to burn with another viewer build than the one in `$DOCSXAI`.

`pipeline.sh` does five things:

1. `docsxai lint` and `docsxai capture-auth --headless` (writes `.auth/ana.json`, never committed).
2. `docsxai run` once per page (`--start-from` and `--stop-after`, merged by step id). A page that halts on the dev badge, or whose obstacle scan timed out, is repeated up to 8 times. A full-flow retry would lose the pages already captured.
3. `docsxai-viewer burn` bakes halos, badges and callouts into `docs/<flow>/burned/`.
4. `scripts/build-screens.mjs` writes `.screens/<flow>/<step>.<hash8>.png` and `.screens/manifest.json` (`docsxai/screens-pack@1`). It stops when a page has no entry in `alt.json`, when `alt.json` names a page that was not captured, or when an alt or callout holds a loopback address.
5. Prints how many page attempts were retried.

Two passes against the same demo state produce byte-identical `.screens/` folders. A changed hash means the app changed.

Edit a flow by hand and re-run. `docsxai lint .` checks it first.

## Pack shape

`.screens/manifest.json` has schema id `docsxai/screens-pack@1`. It is a docsxai-local shape and does not match any site-side manifest schema.

```json
{
  "schema": "docsxai/screens-pack@1",
  "screens": {
    "<page>": {
      "alt": "Board with each task as a card, grouped by status.",
      "variants": {
        "<locale>.<theme>.<viewport>": {
          "src": "/screens/<desktop-1280|mobile-390>/<page>.<hash8>.png",
          "width": 1280,
          "height": 800,
          "bytes": 145358,
          "callouts": ["Caption of callout 1.", "Caption of callout 2."]
        }
      }
    }
  }
}
```

- `<page>` is the step id of the captured page, such as `board` or `agent-tokens`.
- `alt` is one short English description of the page, from `alt.json`. Both viewports of a page share it. For `agent-tokens`, `agent-tokens-issued` and `connect` it says that the URL block is left blank.
- The variant key is one string: `en.dark.1280` for the desktop flow and `en.dark.390` for the mobile flow.
- `<hash8>` is the first 8 hex digits of the PNG's SHA-256, so an unchanged image keeps its path.
- `callouts` holds the English captions in badge order. A page can have fewer callouts on mobile.

## Delivering to trackxai

The pack is the whole `.screens/` folder. The trackxai site serves it as static files.

1. Run `pipeline.sh` against a fresh demo (see above) and check the images.
2. In the trackxai checkout, replace the contents of `apps/site/public/screens/` with the contents of `.screens/`. Delete older files in `screens/` first, since each pack names its images by hash.
3. `manifest.json` lists every page and its images. Its shape is described under Pack shape below.
4. Commit the PNGs and the manifest in the trackxai PR. Do not commit them to docsxai.
