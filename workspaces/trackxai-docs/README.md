# trackxai docs workspace

A docsxai workspace that documents trackxai. It walks the seeded demo target (Acme Demo, loopback only), captures 16 pages at two viewports and packs them as hashed PNGs with a manifest.

| Folder or file       | What it holds                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| `flows/`             | One flow per viewport: `desktop-1280` (1280x800) and `mobile-390` (390x844)   |
| `auth/strategy.yaml` | Signs in as Ana through the demo login route (loopback only, no secret)       |
| `.docsxai.json`      | Workspace config: demo URL and `annotations.obstacles` so callouts avoid text |
| `scripts/`           | `pipeline.sh`, `flow-segments.mjs`, `build-screens.mjs`                       |
| `docs/`, `.screens/` | Generated output, ignored by git (also `.auth/` and `.viewer/`)               |

Both flows run English, dark, `en-US`, UTC, reduced motion, with the browser clock pinned to the demo clock (`2026-01-15T10:00:00Z`).

Pages, per viewport: board, palette (command palette), ticket (WEB-8), waiting (waiting on you), list, backlog, epics, epic (checkout redesign), progress, documents, document (checkout redesign brief), mine (leading tab), settings, agent-tokens, agent-tokens-issued (the token table, scrolled into view) and connect. Each has 1 to 3 callouts. The mobile flow shows fewer callouts on pages where the desktop target is hidden or off screen.

## Start the demo target

From a throwaway clone of trackxai, never the working repo or any real account:

```sh
git clone --depth 1 <trackxai remote> trackxai-demo-run && cd trackxai-demo-run
pnpm install --frozen-lockfile && pnpm exec tsc --build
PG_BIN=/opt/homebrew/opt/postgresql@18/bin scripts/demo/start.sh   # http://127.0.0.1:3100
```

Add `devIndicators: false` to `nextConfig` in the clone's `apps/web/next.config.mjs` first. Without it the Next dev badge shows on every load and the `*-no-dev-overlay` guard halts every page. With it, the badge still shows on about one load in ten (a "1 Issue" toast), which `pipeline.sh` retries.

Stop it when done: `scripts/demo/start.sh stop --clean-build`. One demo instance at a time.

## Run

```sh
export DOCSXAI=<path to a docsxai checkout, built with pnpm -r build>
cd workspaces/trackxai-docs
sh scripts/pipeline.sh            # packs into .screens/
sh scripts/pipeline.sh /some/dir  # packs somewhere else
```

`pipeline.sh` does five things:

1. `docsxai lint` and `docsxai capture-auth --headless` (writes `.auth/ana.json`, never committed).
2. `docsxai run` once per page (`--start-from` and `--stop-after`, merged by step id). A page that halts on the dev badge, or whose obstacle scan timed out, is repeated up to 8 times. A full-flow retry would lose the pages already captured.
3. `docsxai-viewer burn` bakes halos, badges and callouts into `docs/<flow>/burned/`.
4. `scripts/build-screens.mjs` writes `.screens/<flow>/<step>.<hash8>.png` and `.screens/manifest.json` (`docsxai/screens-manifest@1`).
5. Prints how many page attempts were retried.

Two passes against the same demo state produce byte-identical `.screens/` folders. A changed hash means the app changed.

Edit a flow by hand and re-run. `docsxai lint .` checks it first.

## Delivering to trackxai

The pack is the whole `.screens/` folder. The trackxai site serves it as static files.

1. Run `pipeline.sh` against a fresh demo (see above) and check the images.
2. In the trackxai checkout, replace the contents of `apps/site/public/screens/` with the contents of `.screens/`. Delete older files in `screens/` first, since each pack names its images by hash.
3. `manifest.json` lists every screen by step name. Each entry has `variants` keyed `en.dark.1280` and `en.dark.390`, and each variant has `src` (a path under `/screens/`), `width`, `height`, `bytes` and the `callouts` captions in order. Read it to pick an image and its alt text.
4. Commit the PNGs and the manifest in the trackxai PR. Do not commit them to docsxai.
