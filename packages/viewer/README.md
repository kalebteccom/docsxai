# @kalebtec/docsxai-viewer

Static-HTML interactive viewer + burned-annotation renderer. The viewer overlays a pulsing halo, a numbered badge (when a step has multiple call-outs), and a hover-revealed Popper-placed callout from `annotations.json` over clean screenshots at render time. Per-annotation `nudge: { x, y }` lets the author shift a callout aside when two would otherwise overlap; the halo stays anchored on the target.

PNGs in the doc pack stay clean (no baked annotations) — re-stylable, re-localisable, and machine-inspectable. For delivery surfaces that can't run the interactive viewer (Confluence, Notion, plain wikis), `burn` bakes the same annotations into copies of the PNGs.

## Surface

- **`buildViewer({ docsDir, outDir })`** — reads `<docsDir>/<flow>/annotations.json` + screenshots, emits `<outDir>/index.html` + per-flow pages. Idempotent.
- **`placeCallout(input)`** in `src/placement.ts` — Popper-like placement logic. Pure, coordinate-space-agnostic; tested independently. The single placement implementation shared by the browser overlay and the burner.
- **`burnAnnotations({ screenshotPath | screenshotBuffer, annotations, options? })`** — returns the burned PNG as a `Buffer`.
- **`burnFlow({ docsDir, flow, outDir? })`** — batch helper: burns every screenshot of a flow into `docs/<flow>/burned/` (annotation-less steps are copied unchanged so the directory is the complete drop-in image set).
- **`docsxai-viewer`** bin:
  - `docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...` — the engine's `site-docs render` shells out to this.
  - `docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>]` — writes `docs/<flow>/burned/<step>.png`.

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
- **Engine-decoupled.** The annotation record type is redeclared structurally in `src/annotations.ts` — it mirrors the `site-docs/annotations@1` schema; the viewer never imports the engine package.

### Vendored font

`assets/fonts/inter-regular.ttf` — Inter Regular v4.1 from the official [rsms/inter](https://github.com/rsms/inter) release, licensed under the SIL Open Font License 1.1 (`assets/fonts/LICENSE.txt`). Satori needs raw font bytes; only the Regular weight ships, so bold-ish elements (the badge) render in Regular.

Design: `projects/automated-site-documentation-bot/spec.md` in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio.

## License

[Apache-2.0](../../LICENSE). Runtime deps: `satori` (MPL-2.0), `@resvg/resvg-js` (MPL-2.0), `micromark` (MIT); vendored Inter font (OFL-1.1).
