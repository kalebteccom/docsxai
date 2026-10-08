# @docsxai/viewer

Static-HTML interactive viewer + burned-annotation renderer + Starlight docs-site emitter. The viewer overlays a pulsing halo, a numbered badge (when a step has multiple call-outs), and a Popper-placed callout revealed on hover, focus or tap from `annotations.json` over clean screenshots at render time. Per-annotation `nudge: { x, y }` lets the author shift a callout aside when two would otherwise overlap; the halo stays anchored on the target.

PNGs in the doc pack stay clean (no baked annotations) — re-stylable, re-localisable, and machine-inspectable. For delivery surfaces that can't run the interactive viewer (Confluence, Notion, plain wikis), `burn` bakes the same annotations into copies of the PNGs.

## Surface

- **`buildViewer({ docsDir, outDir })`** — reads `<docsDir>/<flow>/annotations.json` + screenshots, emits `<outDir>/index.html` + per-flow pages. Idempotent.
- **`placeCallout(input)`** in `src/placement.ts` — Popper-like placement logic. Pure, coordinate-space-agnostic; tested independently. The single placement implementation shared by the browser overlay and the burner.
- **`burnAnnotations({ screenshotPath | screenshotBuffer, annotations, options? })`** — returns the burned PNG as a `Buffer`.
- **`burnFlow({ docsDir, flow, outDir? })`** — batch helper: burns every screenshot of a flow into `docs/<flow>/burned/` (annotation-less steps are copied unchanged so the directory is the complete drop-in image set).
- **`buildPack({ source, burn?, optimise?, publicPrefix?, generatedFor? })`**, **`writePack({ outDir, files, manifestText })`**, **`computeDrift({ fresh, against, thresholdPct? })`**, **`validatePack(value)`**, **`convertScreensPackV1`** and **`convertScreensManifestV1`**: the screenshot pack (`docsxai/screens-pack@2`); see [Screenshot pack](#screenshot-pack).
- **`emitStarlightSite({ workspaceDir, outDir, config? })`** / **`buildStarlightSite({ siteDir })`** — the production docs-site renderer; see [Starlight site](#starlight-site).
- **`docsxai-viewer`** bin:
  - `docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...` — the engine's `docsxai render` shells out to this.
  - `docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>] [--report <file>] [--max-overlap <ratio>] [--no-connector-outline]` — writes `docs/<flow>/burned/<step>.png`.
  - `docsxai-viewer pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]` and `docsxai-viewer pack <workspace-or-raw-dir> --check --against <pack-dir> [--from-raw] [--threshold <pct>]`: the screenshot pack and its drift check. The engine's `docsxai pack` and `docsxai pack --check` run these.
  - `docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--flow <name>]...` — emits (and with `--build` builds) the Starlight site.

## Screenshot pack

`pack` turns a workspace or a raw capture directory into the file set a docs site or README ships: each step's annotations burned into its clean screenshot (the same `renderBurn` as `burn`, so obstacles, `placement`, `nudge` and the dark-connector outline apply), the PNG optimised losslessly, named `<flow>/<step>.<hash8>.png` from its final bytes, and a `manifest.json`. `drift` rebuilds the pack in memory and compares it with a committed one. The code is `src/pack-*.ts`, one reason to change each:

| File                                  | Holds                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pack-schema.ts`                      | The `docsxai/screens-pack@2` types, id and variant-key patterns, public-prefix and file-path helpers, canonical serialisation                                                                                                   |
| `pack-validate.ts`                    | `validatePack` / `assertValidPack`: pure, every problem as a path-prefixed line, unknown keys are errors                                                                                                                        |
| `pack-convert.ts`                     | `convertScreensPackV1` (returns the file moves it implies) and `convertScreensManifestV1` (takes `bytesOf(src)`); both validate their result                                                                                    |
| `pack-guards.ts`                      | `guardPack`: loopback and private-network addresses, emails, non-Bearer `Authorization:` headers, URL-query tokens and obvious secrets in title, caption, alt and callout copy; names the path and rule, never the matched text |
| `pack-source.ts`, `pack-workspace.ts` | The raw-capture reader and the workspace reader (`pack.json`), both returning a `PackSource`; `pack-annotations.ts` turns annotations into records and callouts                                                                 |
| `pack-optimise.ts`                    | `createOxipngOptimiser`: `oxipng -o 4 --strip safe` through a temp file, or the identity optimiser for `--no-optimise`                                                                                                          |
| `pack-build.ts`                       | `buildPack`: burn, optimise, check the size, hash the final bytes, assemble, validate, guard                                                                                                                                    |
| `pack-write.ts`                       | `writePack`: writes changed files, then removes the files the previous manifest listed and the new one does not                                                                                                                 |
| `pack-pixels.ts`, `pack-drift.ts`     | Exact RGBA comparison (decoded through resvg, transparent reads as white) and the drift report                                                                                                                                  |
| `pack-cli.ts`                         | argv and exit codes for the two commands                                                                                                                                                                                        |

**Manifest.** `docsxai/screens-pack@2`: `{ schema, generated_for?, flows: { <flow>: { title?, steps: { <step>: { caption?, alt, variants: { "<locale>.<theme>.<viewport>": { src, width, height, bytes, callouts: [{ index, copy, bbox? }] } } } } } } }`. `title`, `caption` and `alt` are `{ <locale>: text }`; `alt` must have every locale a variant of the step uses. A locale is a tag like `en` or `pt-BR`, a theme is `^[a-z][a-z0-9-]{0,23}$`, a viewport is 3 or 4 digits; nothing is limited to en/es, light/dark or 390/1280. Flow and step ids are lowercase words joined by `-` or `_`, at most 64 characters, no dots. `src` is `<public-prefix>/<flow>/<step>.<hash8>.png` (default prefix `/screens`). Keys are sorted at every depth, callouts are in index order, there are no timestamps, and the same input gives the same text and the same bytes.

**Sources.** A raw capture is `<root>/<flow>/<step>/<locale>.<theme>.<viewport>.png` with a `.json` sidecar (`width` and `height` must match the PNG when present; `annotations` of `{ index, copy, bbox, arrow_style?, nudge?, obstacles?, placement? }`), `step.json` (`alt`, `caption?`) and `flow.json` (`title?`); a step's badge numbers are drawn when it has two or more annotations, as the engine does. A workspace reads `docs/<capture-flow>/screenshots/<step>.png` and `annotations.json` through `pack.json` (`docsxai/pack-config@1`): `sources` maps a capture flow to `{ flow, variant }`, `flows.<flow>.steps.<step>` holds `alt` and `caption?`. Every screenshot needs a `steps` entry and every entry needs a screenshot. A matrix flow (`docsxai run` on a flow with `matrix:`) writes `docs/<flow>/<variant id>/screenshots/` and `annotations.json`, one directory per cell, and `pack.json` reads those directories in two forms (`pack` and `pack --check` resolve them the same way):

```json
{
  "schema": "docsxai/pack-config@1",
  "sources": {
    "login-mobile": { "flow": "login", "matrix": "es-ES.dark.mobile-390", "variant": "es.dark.390" }
  },
  "matrixFlow": {
    "flow": "login",
    "auto": true,
    "map": { "en-US.light.desktop-1280": "en.light.1280" }
  },
  "flows": {
    "login": { "steps": { "home": { "alt": { "en": "Sign-in page", "es": "Pagina de acceso" } } } }
  }
}
```

A `sources` entry with `matrix` names one variant directory; its key is only a label, and `flow` is the matrix flow and the pack flow. `matrixFlow` takes every variant directory of one flow: `map` gives `<matrix id>: <pack key>`, and `auto: true` maps the ids that already read `<locale>.<theme>.<viewport width>` (the matrix needs a viewport named by its width, `{ name: "1280", ... }`, for that; a preset such as `desktop-1280` has to be in `map`). A directory with no pack key, a mapped id with no directory and two ids of one flow that map to one key stop the pack and name the ids (with the ids on disk for a missing one). Use the `sources` form to pack a subset of the variants. A symlinked flow, variant or `screenshots/` directory stops the pack (a symlinked variant directory under a matrix flow is skipped with a warning), a flow with more than 256 variant directories is refused, and `sources` names `__proto__`, `constructor` and `prototype` and names that differ only by case from the `matrixFlow` flow are refused. Errors name paths relative to the workspace. `packFlow` sets the flow id in the pack when the matrix flow's name is not a valid one (uppercase, dots). Callouts in the manifest are the annotations the burner draws: a `bounding_box` and non-empty `copy`.

**Optimising and hashing.** `oxipng` is external (`brew install oxipng`): `$DOCSX_OXIPNG_BIN` or PATH. The file name carries the first 8 hex digits of the sha256 of the optimised bytes, `bytes` is that file's size, and the output's dimensions are checked against the capture. Optimising is lossless, so two builds with the same `oxipng` give the same names; a different `oxipng` version can change them. The output is checked before it is hashed: a complete PNG with the input's pixels, or the build stops.

**Pruning.** `writePack` reads the `manifest.json` already in the output directory (this shape, `docsxai/screens-pack@1` or `docsxai/screens-manifest@1`) and removes exactly the `<flow>/<file>` paths it lists that the new pack does not. The directory is never scanned; a file nobody listed stays. A flow directory that ends up empty is removed with a non-recursive `rmdir`.

**Drift.** For each variant id (`<flow>/<step>/<key>`): equal hash8 is unchanged; otherwise both PNGs are decoded and compared. `changed` shows the share of changed pixels (4 decimals) and the region box, and fails when the share is above the threshold (default 0.5); a pixel-identical rebuild is not listed. `resized`, `new`, `missing` and `broken` (the committed file is absent or does not match its name) always fail. Drift never optimises, so it needs no `oxipng`. Only a `docsxai/screens-pack@2` manifest can be the committed side.

## Starlight site

`emitStarlightSite` writes a complete, buildable [Astro Starlight](https://starlight.astro.build/) project from a doc pack — the production docs-site renderer beside the single-file interactive viewer, not a replacement for it. The first-party plugin package `@docsxai/plugin-starlight` exposes it to the engine's plugin runtime as the `starlight:site` renderer.

What gets emitted:

- **One MDX page per flow** — an H2 per step, the step's `<step>.md` prose verbatim, and an `<AnnotatedShot>` figure per screenshot. The figure's caption lists each annotation's copy, numbered (`<li value>`) to match the badge indexes burned into the image — caption numbering and burned pixels can't drift apart.
- **Burned-image preference** — `docs/<flow>/burned/<step>.png` is copied when present, the clean screenshot is the fallback, and a missing image becomes a placeholder plus a warning (never a failure).
- **A landing page** of flow link-cards with step/annotation counts, and a **sidebar ordered by the workspace's flow `extends` graph** (roots alphabetical, children nested DFS; flows without a flow-file append alphabetically) — the same shape as `docsxai flow-tree`.
- **Theme from the style artifact** — `docs/style.json`'s `visual` keys (`brand_color` > `accent` > `primary_color`) become a derived `--sl-color-accent-*` scale for both color schemes; `visual.logo` is copied in. Explicit `--title` / `--accent` / `--logo` config overrides win. An unparsable style accent is a warning; an unparsable explicit accent is an error.
- **Pinned, self-contained output** — the emitted `package.json` exact-pins `astro@7.3.5` + `@astrojs/starlight@0.41.2` (both MIT; matching this package's devDependencies, where the pair is tested). No remote fonts, no CDN imports anywhere in the emitted tree — Starlight ships its own assets and Pagefind search at build time; a test greps every emitted text file for external URLs.
- **Deterministic** — same doc pack + same config → byte-identical file tree (no timestamps, sorted writes), asserted by a two-emit golden test.

`buildStarlightSite({ siteDir })` runs `astro build` programmatically: it resolves the astro bin from this package's own install and, when the emitted site has no `node_modules`, symlinks the astro + starlight installs in individually — so building never touches the network. `ASTRO_TELEMETRY_DISABLED=1` is always set. That zero-install shortcut requires the site directory to share a filesystem ancestor with the docsxai install (the normal case — the site is emitted inside the repo that installed it); for a fully detached site directory, `npm install` inside the emitted site and build there. The real-build E2E test is opt-in via `DOCSX_STARLIGHT_BUILD=1` (the default test run never invokes astro).

## Accessibility and keyboard

The emitted pages have a skip link, header/main/footer landmarks, one `<h1>` per page and an `<h2>` per step (write-up headings move down two levels), and colour tokens that meet WCAG AA in light and dark schemes (`src/viewer-style.ts`; `test/viewer-style.test.ts` computes the ratios). Every scroller gets a thin scrollbar whose thumb is the scheme's text colour at 50% (at least 3:1 against every page surface); forced colours and `prefers-contrast: more` keep the system scrollbar. A call-out's halo is a button labelled with its copy: focus, hover or a tap shows the callout, Esc hides it. Keys, listed on every page under "Keyboard shortcuts" from the same table the handler reads (`src/viewer-keys.ts`):

| Key        | Action                             |
| ---------- | ---------------------------------- |
| `→` or `j` | Next step (next card on the index) |
| `←` or `k` | Previous step                      |
| Home / End | First / last step                  |
| `]` / `[`  | Next / previous flow               |
| Esc        | Hide the open callout              |

Keys with Ctrl, Alt, Cmd or Shift, and keys typed into a field, go to the browser. A step change moves focus to the step and is announced through a live region. The halo pulse stops under `prefers-reduced-motion`, image boxes are reserved from the PNG size, and a damaged `annotations.json`, a missing screenshot or an image that fails to load (with Retry) each get a message on the page. The audit behind these is `docs/ai-context/ux/viewer-audit.md`.

## Overlay single-sourcing

The script inlined into every flow page is **generated, not hand-maintained**. `src/overlay-runtime.ts` (browser-side DOM logic) imports the real `placeCallout` from `src/placement.ts`; the package build runs `scripts/bundle-overlay.mjs` (esbuild API) before `tsc`, bundling it to `dist/generated/overlay.js` — an unminified es2019 IIFE with no sourcemap, kept readable for auditability. `render.ts` reads that bundle at render time (resolved relative to `import.meta.url`, with a `src/` → `../dist/` fallback for running from source) and inlines it into each page. The bundle is byte-deterministic for a given esbuild version and is **not** committed; `pnpm build` (or `pnpm test`, which bundles first) produces it.

## CSP posture

Every emitted page carries
`Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`
— matching the inline-asset reality (inline `<style>`/`<script>`, workspace-local images) while blocking **all network egress**: no CDN fetches, no remote fonts, no beacons. The emitted HTML is fully self-contained.

## Step write-ups

`docs/<flow>/<step>.md` files render through [micromark](https://github.com/micromark/micromark) in its safe default mode: raw HTML in the markdown is escaped and dangerous link protocols are dropped, so a write-up can't introduce markup or script into the page.

## Burned annotations (`burn.ts`)

Design constraints, in order:

- **Browser-free.** No Chromium, no Playwright, no DOM. The pipeline is Satori (HTML/CSS-subset flexbox layout → SVG) → `@resvg/resvg-js` (SVG → PNG). A regression test asserts no viewer source module imports playwright.
- **Deterministic.** Same inputs → byte-identical PNG, asserted by a two-run golden test. The clean screenshot is embedded in the Satori tree as a data-URI `<img>`, so the whole frame rasterises in a single resvg pass — one encoder produces every output byte and there is no separate composite/re-encode step. Satori layout and resvg rasterisation are pure functions of their inputs; system fonts are never loaded; text is emitted as glyph paths; resvg writes no timestamps.
- **Faithful to the interactive viewer.** Halo (accent border + glow) on the bounding box, numbered badge when `index` is present (filled `#c2410c`, the viewer badge's AA colour; the halo stays `#e8590c`), rounded-rect callout (white background, 1px border) with copy wrapped to the same 280px outer clamp, triangle arrow per `arrow_style` (8 directions), `nudge` offsets applied to callout + arrow only. Placement reuses `placeCallout`; text measurement/wrapping uses the vendored font's own cmap/hmtx metrics (`src/font-metrics.ts`) as the burner's stand-in for the overlay's DOM measuring probe.
- **Connectors on dark screenshots.** The arrow and stem are near-black ink (`#1c1c1c`, luma 28), which vanishes on a dark UI. `renderBurn` reads the screenshot's pixels (`src/screenshot-pixels.ts`: resvg draws the PNG 1:1 onto white and returns the RGBA, so palette, 16-bit, interlaced and alpha PNGs all decode; transparent areas read as white) and, per annotation, samples every pixel under the arrow and stem boxes, each grown by 2 px (`src/connector-contrast.ts`). A pixel is dark when its integer Rec. 601 luma, `(77 r + 150 g + 29 b) >> 8`, is under 110. When at least a third of the sampled pixels are dark, a 2 px white (`#ffffff`) outline is painted under the ink: a box grown by 2 px around the stem, and the arrow's triangle grown by 2 px on every edge with mitred corners (`arrowHaloGeometry`, `src/arrow.ts`), both before the inks (`src/burn-connector.ts`). The ink keeps its colour and geometry, and the outline sits under the same boxes the planner scores plus 2 px. A path half on light and half on dark counts as dark, since the outline costs nothing on the light part. On light screenshots no outline node is emitted, so the Satori tree and the PNG bytes are those of a burn without the check. The callout box (white fill, ink border), the target halo and the badge are unchanged: the badge's white 2 px border and orange fill already contrast on dark. Integer maths and fixed thresholds, so the same screenshot and annotations burn to the same bytes. Opt out with `docsxai-viewer burn --no-connector-outline`, or `connector: "off"` in `BurnOptions` / `burnFlow` options (the default is `"auto"`); `buildBurnTree` takes the same decision from an optional `pixels` grid and draws plain ink without it. No annotation or schema field is involved.
- **Obstacle-aware placement (optional).** An annotation record may carry `obstacles?: BoundingBox[]`: boxes of page content, in screenshot pixels, the callout must not cover (the target is not listed). Records with obstacles go through `planCallout` (`src/obstacle-placement.ts`): it enumerates callouts on every side, at base gap + {0, 12, 28, 48, 76, 112, 160, 224, 320} px and slid along the target's edge in 8 px steps (the stem leaves the callout at least 10 px from its corners and the arrow tip stays inside the target's span). A joining stem (2px bar, `src/arrow.ts`) is drawn when the callout is more than the base gap away; the arrow tip always stays on the target's edge. Each candidate is scored by overlap area with obstacles (10x, plus a 4px clearance band), other annotations' halos and badges and earlier callouts (8x), the arrow and stem on either (6x), and the part outside the image (50x), plus small costs for stem length, slide and leaving the `arrow_style` side. The lowest cost wins; ties go to the preferred side, then the smaller move, then enumeration order, so the same input burns to the same bytes. No clear spot means the least-overlap one. `nudge` is applied to candidates before scoring. Absent or empty `obstacles` takes the original `placeCallout` path unchanged. `docsxai run` writes the field when the workspace sets `annotations.obstacles` in `.docsxai.json` (see the engine README). The interactive viewer ignores the field.

- **Badge placement with obstacles.** The numbered badge normally sits 8 px up-left of the halo, which hides the target's own first letter when the target is flush text (a title, a tab, a list row) and covers neighbours when they sit close. On records with `obstacles`, `planBadge` (`src/badge-placement.ts`) tries the four corners (up-left, up-right, down-left, down-right) at 8, 14, 20 and 26 px outward and keeps the lowest cost: 1 per px² on an obstacle, another annotation's halo or a placed callout, arrow or stem, plus 0.5 per px² on the target's own box. At 26 px the badge sits clear of the target's corner; if no spot is clear of both, the least cost wins. Ties go to enumeration order (nearest offset first, then the corner order above), so the same input burns to the same bytes. The badge is placed before the annotation's callout, so that callout and later ones keep clear of where it landed. Records without `obstacles` keep the up-left badge exactly as before.
- **Callout width on small screenshots.** A callout is at most 280 px wide. On records with `obstacles` it is at most `min(280, 0.62 x image width)`, never under 168 px (242 px at 390 px wide; 280 from 452 px up). When that box has no clear spot, `layoutCallout` (`src/burn-callout.ts`) also tries two narrower ones, halfway to the floor and the floor itself, and keeps the first (widest) that covers nothing; when none is clear, the one that covers least, widest among equals. Records without `obstacles` keep the fixed 280 px, and wide screenshots with `obstacles` never shrink, so existing packs burn to the same bytes.
- **Per-annotation `placement` (optional).** `placement` on a record (or on a flow-file step annotation, which copies it onto the record) steers the burner. Every key is optional; an absent or empty object changes nothing. The record is read by the burner only, the interactive viewer ignores it.
  - `inside: true` puts the callout inside the target, with no arrow or stem, when the target can hold it with an 8 px margin (the callout narrows to the target's width down to 120 px first). `src/inside-placement.ts` scores a grid of positions (8 px steps, at most 40 per axis) against `obstacles`, other halos, badges and earlier callouts, and keeps the cheapest; ties go to the position nearest the resting spot, the top edge centred unless `side` or `align` say otherwise. A target too small to hold the callout gets the usual outside placement. The engine's obstacle scan leaves out the target's own subtree, so to keep an inside callout off content inside the target, list those boxes in `obstacles` by hand.
  - `side` (`top`, `bottom`, `left`, `right`) tries only that side of the target, and falls back to the usual order only when it has no spot inside the image. Without it, `arrow` is a soft hint: the side is tried first but any overlap outweighs it. The corner half of `arrow` (`top-left`, `bottom-right`) is ignored; use `align` for that.
  - `align` (`start`, `center`, `end`) rests the callout flush with the target's start or end edge, or centred (the default), before it slides.
  - `pin_arrow: true` makes `nudge` move the callout alone: the arrow tip stays on the target's edge and a stem joins the two. The component across the edge changes the callout's distance (at least 8 px), the component along it slides the callout while a stem can still attach. Without it `nudge` moves callout and arrow together, as before.
  - `max_width` (120 to 560) replaces the widest box of the width ladder.
  - `obstacle_radius` (CSS px, 0 to 2000) and `obstacle_limit` (1 to 40) are read by `docsxai run`'s obstacle scan, not by the burner.
- **Never drops, reports.** The burner draws every annotation that has a `bounding_box`, wherever the best layout lands. `renderBurn` returns the PNG and a report entry per annotation; `burnFlow` returns the flow's; `docsxai-viewer burn <workspace> --report <file>` writes them as `docsxai/burn-report@1` JSON (a relative `<file>` lands under the workspace root, an absolute one is used as given; `--max-overlap <ratio>` sets the threshold). Each entry has `step`, `index`, `selector`, `mode` (`outside`, `inside`, `none`), `side`, the `callout` and `badge` boxes in screenshot pixels, `obstacle_overlap` and `other_overlap` (px² of callout, arrow and stem on `obstacles`, and on other halos, badges and earlier callouts), `overlap_ratio` (both over the callout's area) and `unplaceable`. `unplaceable` is true when `overlap_ratio` is above 0.1 (the default threshold): the best layout still covers more than a tenth of its own area. The pipeline decides what to do with those: shorten the copy, add `placement`, or remove the annotation from `annotations.json`. Annotations skipped for lack of a `bounding_box` or a screenshot appear with `mode: "none"` and a `skipped` reason.
- **Engine-decoupled.** The annotation record type is redeclared structurally in `src/annotations.ts` — it mirrors the `docsxai/annotations@1` schema; the viewer never imports the engine package.

### Vendored font

`assets/fonts/inter-regular.ttf` — Inter Regular v4.1 from the official [rsms/inter](https://github.com/rsms/inter) release, licensed under the SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`). Satori needs raw font bytes; only the Regular weight ships, so bold-ish elements (the badge) render in Regular.

## License

[Apache-2.0](../../LICENSE). Runtime deps: `satori` (MPL-2.0), `@resvg/resvg-js` (MPL-2.0), `micromark` (MIT); vendored Inter font (OFL-1.1).
