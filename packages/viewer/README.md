# @kalebtec/site-docs-viewer

Static-HTML interactive viewer. Overlays a pulsing halo, a numbered badge (when a step has multiple call-outs), and a hover-revealed Popper-placed callout from `annotations.json` over clean screenshots at render time. Per-annotation `nudge: { x, y }` lets the author shift a callout aside when two would otherwise overlap; the halo stays anchored on the target.

PNGs stay clean (no baked annotations) — re-stylable, re-localisable, and machine-inspectable.

## Surface

- **`buildViewer({ docsDir, outDir })`** — reads `<docsDir>/<flow>/annotations.json` + screenshots, emits `<outDir>/index.html` + per-flow pages. Idempotent.
- **`placeCallout(input)`** in `src/placement.ts` — Popper-like placement logic used by the inline OVERLAY_JS. Pure, coordinate-space-agnostic; tested independently.
- **`site-docs-viewer`** bin — wraps `buildViewer` for CLI use; the engine's `site-docs render` shells out to it.

Phase 2 ships `burn.ts` — a static-render path for delivery surfaces that can't run the interactive viewer (Confluence, Notion). The placement logic is already extracted.

Design: `projects/automated-site-documentation-bot/spec.md` in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio.

## License

[Apache-2.0](../../LICENSE).
