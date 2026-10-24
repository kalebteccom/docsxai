# Burn theme example

A `.docsxai.json` that themes the captions `docsxai burn` and `docsxai pack` draw into screenshots, and that `docsxai render` reads for the interactive viewer. The full key list is in `docs/burn-theming.md`.

`docsxai.json` here is a complete workspace config. Copy its `burn` block into the `.docsxai.json` of your workspace (do not copy the file over it, `app_url` and `created_at` are placeholders).

## What it sets

- `preset: "readable"` turns on `scale: "auto"`, 15 px text and a callout at most 55 percent of the image width, with dark ink on a near-white callout.
- `display_width: 720` is the width in CSS px your docs page shows a screenshot at. Set it to your content column.
- `accent` overrides the halo colour of the preset. Any key you write wins over the preset.

## Choosing `display_width` per variant

`scale: "auto"` is `max(1, image width / display_width)`, at most 4. The block is per workspace, so it holds one `display_width`.

- `en.light.1280` shown at 720 px: auto factor 1.78, captions read at 15 px.
- `en.light.1440` shown at 720 px: auto factor 2, 15 px.
- `en.light.390` shown at its own 390 px: auto factor 1, base size.
- A 780 px phone capture shown at 358 px needs `display_width: 358`: auto factor 2.18, 15 px.

A screenshot narrower than `display_width` keeps base size, so one block serves desktop and mobile captures that the page shows at 720 px or their own width. If your mobile captures are shown in a narrower column than their pixel width, a `display_width` that fits them enlarges the desktop ones (up to the cap of 4). To serve both, give `display_width` an object, `{ "default": 720, "narrow": 358, "narrow_below": 900 }`: screenshots narrower than 900 px use 358 and the others 720 (see `docs/burn-theming.md`).

## Run it

```bash
docsxai burn ./docs-workspace --out ./docs-workspace/burned
docsxai pack ./docs-workspace --out ./docs-workspace/.screens
```

Expect `burned/<flow>/<step>.png` for every flow with an `annotations.json`, and `.screens/manifest.json` from `pack`, with a halo in `#0b6e4f`, a numbered badge and a callout in the `readable` look on each. A bad key or value stops the command and lists each problem with its key. Text colours under WCAG AA print a warning.

## trackxai tokens pair

`trackxai-light.tokens.json` and `trackxai-dark.tokens.json` are W3C tokens files for a light and a dark app: Kalebtec violet on paper, and light violet on ink. Each sets the callout, badge and halo colours, 15 px text, `shape.connector: "line"`, and under `render` a `scale` of `auto` with a `display_width` of 1100 (350 under 900 px), the widths the landing shows its captures at. That gives 17.6 px burned text on a 1280 capture and 16.8 px on a 390 one, 15 px on the page for both. `render` has no default token path, so map it:

```json
{
  "burn": {
    "theme": {
      "from": "trackxai-dark.tokens.json",
      "tokens": { "scale": "render.scale", "display_width": "render.display-width" }
    }
  }
}
```

`node scripts/burn-trackxai-sample.mjs` burns synthetic screens with both files, with the old triangle connector and with the line, and prints the before and after paths. `node scripts/burn-trackxai.mjs --raw <dir> --out <dir>` burns raw captures (`<screen>.<locale>.<theme>.<width>.png` with a `trackxai/raw-capture-sidecar@1` sidecar) into a screens pack and merges its `manifest.json`; see the script's header for `--rename`, `--screens` and `--compare`. Phone captures burn with `caption_style: "auto"`, desktop ones with `full`; the script prints what each caption still covers (`check:`) and which annotations fell back to a badge.
