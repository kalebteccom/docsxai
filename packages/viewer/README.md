# @docsxai/viewer

Static-HTML interactive viewer + burned-annotation renderer + Starlight docs-site emitter. The viewer overlays a pulsing halo, a numbered badge (when a step has multiple call-outs), and a hover-revealed Popper-placed callout from `annotations.json` over clean screenshots at render time. Per-annotation `nudge: { x, y }` lets the author shift a callout aside when two would otherwise overlap; the halo stays anchored on the target.

PNGs in the doc pack stay clean (no baked annotations) — re-stylable, re-localisable, and machine-inspectable. For delivery surfaces that can't run the interactive viewer (Confluence, Notion, plain wikis), `burn` bakes the same annotations into copies of the PNGs.

## Surface

- **`buildViewer({ docsDir, outDir })`** — reads `<docsDir>/<flow>/annotations.json` + screenshots, emits `<outDir>/index.html` + per-flow pages. Idempotent.
- **`placeCallout(input)`** in `src/placement.ts` — Popper-like placement logic. Pure, coordinate-space-agnostic; tested independently. The single placement implementation shared by the browser overlay and the burner.
- **`burnAnnotations({ screenshotPath | screenshotBuffer, annotations, options? })`** — returns the burned PNG as a `Buffer`.
- **`burnFlow({ docsDir, flow, outDir? })`** — batch helper: burns every screenshot of a flow into `docs/<flow>/burned/` (annotation-less steps are copied unchanged so the directory is the complete drop-in image set).
- **`emitStarlightSite({ workspaceDir, outDir, config? })`** / **`buildStarlightSite({ siteDir })`** — the production docs-site renderer; see [Starlight site](#starlight-site).
- **`docsxai-viewer`** bin:
  - `docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...` — the engine's `docsxai render` shells out to this.
  - `docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>]` — writes `docs/<flow>/burned/<step>.png`.
  - `docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--flow <name>]...` — emits (and with `--build` builds) the Starlight site.

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
- **Faithful to the interactive viewer.** Halo (accent border + glow) on the bounding box, numbered badge when `index` is present, rounded-rect callout (white background, 1px border) with copy wrapped to the same 280px outer clamp, triangle arrow per `arrow_style` (8 directions), `nudge` offsets applied to callout + arrow only. Placement reuses `placeCallout`; text measurement/wrapping uses the vendored font's own cmap/hmtx metrics (`src/font-metrics.ts`) as the burner's stand-in for the overlay's DOM measuring probe.
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
- **Never drops, reports.** The burner draws every annotation that has a `bounding_box`, wherever the best layout lands. `renderBurn` returns the PNG and a report entry per annotation; `burnFlow` returns the flow's; `docsxai-viewer burn <workspace> --report <file>` writes them as `docsxai/burn-report@1` JSON (`--max-overlap <ratio>` sets the threshold). Each entry has `step`, `index`, `selector`, `mode` (`outside`, `inside`, `none`), `side`, the `callout` and `badge` boxes in screenshot pixels, `obstacle_overlap` and `other_overlap` (px² of callout, arrow and stem on `obstacles`, and on other halos, badges and earlier callouts), `overlap_ratio` (both over the callout's area) and `unplaceable`. `unplaceable` is true when `overlap_ratio` is above 0.1 (the default threshold): the best layout still covers more than a tenth of its own area. The pipeline decides what to do with those: shorten the copy, add `placement`, or remove the annotation from `annotations.json`. Annotations skipped for lack of a `bounding_box` or a screenshot appear with `mode: "none"` and a `skipped` reason.
- **Engine-decoupled.** The annotation record type is redeclared structurally in `src/annotations.ts` — it mirrors the `docsxai/annotations@1` schema; the viewer never imports the engine package.

### Vendored font

`assets/fonts/inter-regular.ttf` — Inter Regular v4.1 from the official [rsms/inter](https://github.com/rsms/inter) release, licensed under the SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`). Satori needs raw font bytes; only the Regular weight ships, so bold-ish elements (the badge) render in Regular.

## License

[Apache-2.0](../../LICENSE). Runtime deps: `satori` (MPL-2.0), `@resvg/resvg-js` (MPL-2.0), `micromark` (MIT); vendored Inter font (OFL-1.1).
