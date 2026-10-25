# Theming burned captions

The halo, numbered badge, callout and the connector that joins the callout to its target, as `docsxai burn` and `docsxai pack` draw them into a screenshot, come from one theme. The interactive viewer (`docsxai render`) reads the same values through CSS variables, so a burned image and the live page show the same caption.

A workspace without a theme draws the look docsxai always had, byte for byte. Everything below is opt-in.

## Where the theme lives

The `burn.theme` block of the workspace's `.docsxai.json` is the source of truth:

```json
{
  "schema": "docsxai/workspace@1",
  "burn": {
    "theme": {
      "preset": "soft",
      "accent": "#0b6e4f",
      "font": "fonts/brand-regular.ttf"
    }
  }
}
```

`burn`, `pack`, `pack --check` and `render` read it. `docsxai site` does not: the Starlight emitter takes its accent from `--accent` or the style artifact.

An optional tokens file fills the block (see [Tokens file](#tokens-file)). For the whole path from raw captures to a hash-named pack, see [Themed caption packs](themed-caption-packs.md).

## Layering

Four layers apply in this order, each one overriding the one before it:

1. The default look.
2. `preset`, when set.
3. The tokens file named by `from`, when set.
4. The keys written in the block.

The callout outline colour follows `ink` until a preset, the tokens file or the block sets `callout_border_color`.

## Keys

| Key                    | Type               | Range or values                                 | Default           | What it sets                                                                  |
| ---------------------- | ------------------ | ----------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `preset`               | string             | `clean`, `soft`, `high-contrast`, `readable`    | none              | A built-in look, see [Presets](#presets).                                     |
| `from`                 | string             | path to a `.json` file inside the workspace     | none              | The tokens file.                                                              |
| `tokens`               | object             | theme key to token path                         | none              | Reads a key from another path, and requires it to exist.                      |
| `accent`               | colour             | `#rgb` or `#rrggbb`                             | `#e8590c`         | Halo outline. Its glow is the same colour at 35% opacity.                     |
| `ink`                  | colour             | `#rgb` or `#rrggbb`                             | `#1c1c1c`         | Callout text.                                                                 |
| `callout_background`   | colour             | `#rgb` or `#rrggbb`                             | `#fff`            | Callout fill.                                                                 |
| `callout_border_color` | colour             | `#rgb` or `#rrggbb`                             | the `ink` colour  | Callout outline, and the connector that joins it to its target.               |
| `callout_border_width` | number             | 0 to 6 px                                       | `1`               | Callout outline width. 0 draws no outline and the connector uses `ink`.       |
| `radius`               | number             | 0 to 24 px                                      | `7`               | Callout corner radius. The halo's radius is 4/7 of it.                        |
| `shadow`               | string             | CSS `box-shadow`, up to 3 layers, or `none`     | `none`            | Callout shadow. Layers are `<x> <y> [<blur> [<spread>]] <colour>`.            |
| `badge_shape`          | string             | `circle`, `rounded`, `square`                   | `circle`          | Badge corners: a pill, 6 px, or square.                                       |
| `badge_fill`           | colour             | `#rgb` or `#rrggbb`                             | `#c2410c`         | Badge fill. Its digits and outline are white.                                 |
| `font_size`            | number             | 8 to 32 px                                      | `14`              | Callout text size.                                                            |
| `line_height`          | number             | 8 to 64 px, at least `font_size`                | `19`              | Callout line pitch.                                                           |
| `padding_x`            | number             | 0 to 40 px                                      | `11`              | Callout horizontal padding.                                                   |
| `padding_y`            | number             | 0 to 40 px                                      | `8`               | Callout vertical padding.                                                     |
| `font`                 | string             | path to a `.ttf` or `.otf` inside the workspace | the bundled Inter | Callout and badge font, see [Font](#font).                                    |
| `font_fallback`        | list of strings    | up to 8 `.ttf` or `.otf` paths in the workspace | none              | Fonts for characters `font` lacks, see [Other scripts](#other-scripts).       |
| `font_weight`          | number             | `400` or `600`                                  | `400`             | Callout text weight. The font file must have it, see [Font](#font).           |
| `connector_style`      | string             | `auto`, `line`, `chevron`, `arrow`              | `auto`            | How a callout joins its target, see [Connectors](#connectors).                |
| `caption_style`        | string             | `full`, `badge`, `auto`                         | `full`            | Caption, or badge only, see [Caption style](#caption-style).                  |
| `arrow_size`           | number             | 4 to 24 px                                      | `8`               | Triangle length for `connector_style: "arrow"`. Its base is 7/4 of that wide. |
| `max_width_ratio`      | number             | 0.2 to 1                                        | `0.62`            | Widest callout as a share of the screenshot, see [Scale](#scale).             |
| `scale`                | number or `"auto"` | 0.5 to 4, or `auto`                             | the pixel ratio   | Multiplies every caption dimension, see [Scale](#scale).                      |
| `display_width`        | number or object   | 240 to 2400 px, or an object                    | `720`             | CSS px shown at, or a wide and narrow pair, see [Scale](#scale).              |

Numbers are plain values without a unit: px for sizes, a share for `max_width_ratio`, a factor for `scale`. Colours are stored as lowercase `#rrggbb`.

## Scale

A screenshot wider than the column it is shown in gets scaled down by the page, and the caption drawn into it shrinks with it. A 1440 px screenshot in a 720 px column shows 14 px text at 7 px.

`scale` multiplies every caption dimension: text size, line height, padding, outline, radius, shadow, connector, badge, halo and the callout's width. The layout (which side the callout takes, where it slides) is decided at base size and then multiplied, so a scaled caption sits where the unscaled one sits.

- Without `scale` the factor is the capture's pixel ratio (`device_scale_factor` in `annotations.json`, else 1). A 2x capture gets a caption twice as large in image pixels, so it has the 1x capture's size in CSS px. A 1x capture burns as before.
- A number such as `1.5` or `2` is used as written, whatever the pixel ratio. `scale: 1` keeps the caption at base size in image pixels, which is the look 2x captures had before.
- `"auto"` uses `max(pixel ratio, screenshot width / display_width)`, at most 4 times the pixel ratio, so a screenshot wider than its column gets a larger caption and a narrower one keeps base size. A 1440 px screenshot with the default `display_width` of 720 gives 2. A 390 px screenshot gives 1, and the same screen at 2x (780 px) gives 2.

`display_width` is the width in CSS px the page shows the screenshot at. It only matters for `"auto"`. Wide and narrow screenshots shown at different widths take an object, see [Wide and narrow images](#wide-and-narrow-images).

When the page shows the screenshot at `displayWidth` CSS px, a caption length ends up on screen as:

```text
onscreen = fontSize * auto * (displayWidth / imageWidth)
```

With `auto = imageWidth / displayWidth` that is `fontSize` itself, so `readable` text is 15 px, badge digits 12 px and the halo outline 2 px. A 1440 px screenshot shown at 720 px gives auto 2 and a display factor of 0.5. A 780 px phone screenshot shown at 358 px needs `display_width: 358`: auto is 2.18 (rounded up to 2 decimals) and the display factor 0.46. With the default 720 that screenshot gets auto 1.09 and 15 px text shows at 7.5 px. The cap of 4 covers a 1440 px screenshot shown at 360 px; a screenshot more than 4 times its display width shows captions under base size.

`max_width_ratio` limits the callout's outer width to that share of the screenshot. At the default 0.62 the limit applies to callouts planned around obstacles (242 px on a 390 px screenshot), and other callouts stop at 280 px at base size. A ratio under 0.62 applies to every callout.

`scale`, `display_width`, `arrow_size`, `max_width_ratio`, `connector_style` and `caption_style` apply to burned images only. The interactive viewer shows the screenshot at its own size and keeps its own arrow, so it reads the colour, shape, type and `font_weight` keys and ignores these six.

## Wide and narrow images

Docs sites show a wide desktop capture and a phone capture at different widths: 1440 px shown at 720, 780 px shown at 358. One number cannot fit both, and `display_width: 720` gives the phone capture an auto factor of 1.09 and 7.5 px text. `display_width` also takes an object:

```json
{
  "burn": {
    "theme": {
      "preset": "readable",
      "display_width": { "default": 720, "narrow": 358, "narrow_below": 900 }
    }
  }
}
```

A screenshot narrower than `narrow_below` image pixels (default 900) uses `narrow`, any other uses `default` (720 when absent). With that block a 780 px capture gets auto 2.18 and a 1440 px capture gets 2, so both read at 15 px on the page.

- `narrow` is required. `default` and `narrow_below` must be positive numbers when written.
- Unknown keys, a non-number and a non-positive value stop the command and name the key path, such as `display_width.narrow`.
- The number form has no narrow width. A number written in the block replaces an object from a lower layer.
- A tokens file can supply the object through `tokens`, as the value of the mapped token.
- It only changes `scale: "auto"`. An explicit `scale` ignores it, and the viewer's CSS variables do not read `display_width`.
- In code the resolved theme carries `displayWidth`, `displayWidthNarrow` and `narrowBelow` (the last two are `null` for the number form), and `captionScale(theme, imageWidth, pixelRatio)` picks the width. The resolved `scale` is `null` when no layer sets it, which means the pixel ratio.

## Making captions legible on a docs site

1. Find the width the site shows screenshots at: the content column, in CSS px. 700 to 760 is typical.
2. Set `display_width` to it and `scale` to `"auto"`, or take the `readable` preset, which does.
3. Set `font_size` to the page's body size (15 or 16) so the caption reads like the text beside it.
4. Vendor a font file next to the pack with `font`, so the caption matches the site's typeface and the output stays byte-stable.

```json
{
  "burn": {
    "theme": {
      "preset": "readable",
      "display_width": 720,
      "accent": "#0b6e4f",
      "font": "fonts/brand-regular.ttf"
    }
  }
}
```

Screenshots narrower than `display_width` keep base size, so one block serves mobile captures and wide desktop ones. When the phone captures are shown narrower than their pixel width, use the object form from [Wide and narrow images](#wide-and-narrow-images).

## Placement priorities

When an annotation carries `obstacles`, the burner scores every callout position and keeps the cheapest. A themed burn with the line connector also adds text it finds in the screenshot's pixels, see [Placement with the line](#placement-with-the-line). From most to least important:

1. The callout covers no page content, halo, badge or earlier callout.
2. The connector crosses none of them. Each px of stem inside content costs more than a px of callout covering it, and a brush of under 2 px at a box edge does not count.
3. The callout sits on the side named by `placement.side` or `arrow_style`. That outweighs a sliver of overlap, about 2 px of content along the callout's width, and loses to anything deeper or to a side with no room in the image.
4. The stem is short.

When no spot is clear at full size, the burner retries with the callout's side padding cut by up to 6 px (never below 8 px) and keeps that box if it then fits clear. With `obstacles`, a numbered badge is kept fully inside the screenshot, 2 px from the edge. Without `obstacles`, an `arrow` burn places its badge and callout as before, so a badge on a target at the image edge can still be cut off there.

## Connectors

`connector_style` sets what joins a callout to its target. It is new in the next release. Until then a themed burn draws the `arrow`.

- `line`: a 2 px line from the middle of the caption edge that faces the target to the outside of the halo ring, ending in a dot of 2 px radius. It starts on the caption's outer edge, so there is no gap and it does not run under the caption. The start keeps `radius` + 2 px away from the caption's corners. When the target is off the caption's span, the line takes one right-angle elbow halfway.
- `chevron`: the same line ending in an open chevron with 5 px arms.
- `arrow`: the filled triangle and stem docsxai always drew, with the halo on the target's edge and the badge placed as before.
- `auto`, the default: `line` for a burn with a theme, `arrow` for a burn without one.

Line width, dot radius and chevron arms are all multiplied by `scale`.

### Clean halo and badge

The line comes with a clean halo and badge. The halo ring is 2 px wide and sits 3 px outside the target, with a 3 px glow, so it never covers text inside the target. Its corner radius is 4/7 of `radius` plus 5 px. The numbered badge sits 1 px off a corner of the target, clear of the element. The burner tries the top-left, top-right, bottom-left and bottom-right corners, then beside the middle of the left and right edges, then inside the target's top-left corner. It takes the first spot inside the image that covers no text or other annotation, else the one that covers least.

The badge stays fully inside the image, 6 CSS px from every edge and 12 from the left and right edge of a desktop capture, so a badge at the image edge slides back in along it. It also keeps 6 px off a full-height page divider, a sidebar's edge found in the pixels, so it never reads as part of the sidebar. A desktop caption keeps 12 px off the left and right edge. When no line crosses nothing, the burner still picks a caption spot and line end that run beside every caption and badge placed before, even if the line then crosses a halo.

### Placement with the line

- A caption rests 20 px from its target, so 15 px of line show past the 5 px ring.
- The burner reads text from the screenshot's pixels. It cuts the image into 8 px cells, marks a cell busy when it holds at least 12 luminance steps of 48 or more (at least 4 across and 4 down), and merges busy cells into boxes that join the annotation's `obstacles`. A listed box with nothing drawn in it is dropped. A capture sidecar lists at most 40 boxes, and a burn without `obstacles` gets the same protection.
- A caption that covers text at its resting spot moves out up to 176 px to empty space. A clear spot 150 px away beats a covered one beside the target.
- When nothing within 176 px is clear, a caption above or below its target docks in a band 12 px from the top or bottom edge of the image when the band is within 45% of the image height of the target. A connector that crosses text costs more than one through a gap, so docking takes the gap when there is one.
- When the usual box covers something, the burner tries a box up to 560 px wide (fewer lines), then both again with the text one step smaller: 16 px burned on a screenshot 900 px wide or more, 14 px below that. It keeps the first clear layout, else the one that covers least.
- When the caption is clear but its line still crosses a listed obstacle, another halo, badge or caption, the burner looks for a spot with a straight line that crosses nothing, then for a line with one right-angle elbow, as [Routing the line](annotation-placement.md#routing-the-line) describes. The burn report records each annotation's `route` (`straight`, `elbow` or `none`) and `connector_crossings` (the boxes the drawn line still crosses, 0 once routed). Not in `0.3.0-rc.3`.
- A pinned arrow (`placement.pin_arrow`) keeps the distance steps of an `arrow` burn, up to 320 px past the gap, and does not dock. Its nudge sets the distance. Side hints work as before.
- `docsxai burn --no-connector-outline` skips reading the screenshot's pixels. The line keeps the colour of `callout_border_color`, and the burner finds no text, so it places captions from the listed `obstacles` alone.

The line takes `callout_border_color`, or `ink` when `callout_border_width` is 0. The burner averages the screenshot under the line and checks that colour against it. Under 3:1 it takes whichever of `ink` and `callout_background` has more contrast there, when either beats it. The line has no outline.

A burn without a theme keeps the triangle and its bytes. To keep the triangle in a themed burn, set `connector_style: "arrow"`.

To compare the looks, run `node scripts/burn-trackxai-sample.mjs` after `pnpm --filter @docsxai/viewer build`. It burns three desktop screens in light and dark and a 390 px phone screen in dark with the `examples/burn-theme/trackxai-light.tokens.json` and `trackxai-dark.tokens.json` pair, once with `arrow` at 14 px and once with the theme as written. It prints the 14 PNG paths under `/tmp/burn-before-after`.

`node scripts/burn-trackxai.mjs --raw <dir> --out <dir>` burns a directory of raw captures into a screens pack (its header lists every flag). Add `--webp` to write a lossless `<name>.<hash>.webp` beside each new PNG, made with `cwebp -lossless -z 9`. A twin is kept only when it is under 100 kB and smaller than the PNG; otherwise the script removes it and prints a warning with both sizes. `cwebp` comes from the `webp` package (`brew install webp`, `apt install webp`); without it on `PATH` the run stops before it burns anything. `--badge-only board.390,ticket.en.dark.390` burns those frames as badges and rings only, with no caption or connector. An entry is `<screen>.<width>` for every locale and theme, or `<screen>.<locale>.<theme>.<width>`. The same list can sit under the `badge_only` key of `scripts/burn-trackxai.overrides.json`, or in the file named by `--overrides`. Not in `0.3.0-rc.3`.

`remotxai-light.tokens.json` and `remotxai-dark.tokens.json` are a second example pair: a teal accent and neutral surfaces, 17 px text, and a `display_width` of 800 (390 under 900 px), so a 1280 capture shows at the content width and a 390 one at full width. The pair was drawn for a site set in Instrument Sans, which a tokens file cannot name: set `font` to a copy of it in the workspace.

## Caption style

`caption_style` is new in the next release. It applies with the line connector (`connector_style` `line` or `chevron`, or `auto` with a theme). An `arrow` burn always draws the caption.

- `full`, the default: every annotation gets its caption.
- `badge`: no caption box and no connector. Each target gets its ring and a numbered badge, numbered by its place in the list when it has no `index`. Use it where the page prints the callout text as a numbered list under the image.
- `auto`: the caption when a spot clear of text exists and its connector, straight or with one elbow, crosses no text, else the badge.

The burn report marks each badge-only annotation with `"caption_style": "badge"`, whether `badge` or the `auto` fallback chose it.

## Checking a whole capture folder

`node scripts/burn-probe-batch.mjs --raw <dir> --out <dir>` burns every frame of a raw capture folder with an example tokens pair (see `--project` below) and writes a report of where each caption, connector and badge landed. It lives in `scripts/` of a docsxai checkout, so run it from one after `pnpm --filter @docsxai/viewer build`.

```sh
node scripts/burn-probe-batch.mjs --raw raw --out probe --theme dark --locale en --widths 1280,390
```

`--raw` is read in either layout, detected from the file names. Other files (manifests, READMEs, step metadata) are ignored:

- Flat: `<screen>.<locale>.<theme>.<width>.png` with a `.json` sidecar beside it (`trackxai/raw-capture-sidecar@1`, annotations with `bounding_box`).
- Rawcap: `<flow>/<step>/<locale>.<theme>.<viewport>.png` with a `.json` sidecar beside it (`width`, `height`, annotations with `index`, `copy`, `bbox` and optional `obstacles`). A viewport is a width (`390`) or a name that ends in one (`mobile-390`).

`--theme` (default `dark`), `--locale` (default `en`) and `--widths` (default `1280,390`) pick the frames. The tokens file is `--tokens-dark` or `--tokens-light`, else `examples/burn-theme/<project>-<theme>.tokens.json`, where `--project trackxai|remotxai` (default `trackxai`) picks the pair. Captures under 900 px burn with `caption_style: "auto"`, the others with `full`.

`<out>/previews/` holds the burned PNG of each frame, and `<out>/report.md` the summary (frames, annotations, OK, CHECK, skipped for no `bounding_box`), the CHECK rows, then one row per frame and annotation: mode (`full`, `badge` or `skipped`), side, connector length in px, px² of the caption over listed text and over the phone header and bottom nav, whether the connector crosses listed text, whether the badge sits next to its target, and the verdict.

A row is CHECK when the caption covers listed text or the phone header or nav, the burn marked it `unplaceable`, it covers another annotation's target, caption or badge, its badge is on its target, on listed text or the phone chrome, or more than 6 px from the target, or (phone captures only) its connector crosses listed text. Desktop rows show the crossing without holding it against the verdict.

## Phone captures

A portrait capture under 900 px wide is treated as a phone screen. Its top 56 px (the header), bottom 56 px (the nav bar), the floating action button above the nav bar's right end (76 by 80 px) and a 16 px strip on each side are content. Captions stay off them, and badges stay off the header, nav bar and button. A caption docks 64 px from the top or bottom edge, under the header or above the nav bar. On a screenshot under 900 px wide the smaller text step is compact: 16 px lines for the 14 px text, 4 px of vertical padding and 8 px of horizontal padding.

Those sizes are CSS px. A 2x capture (780 by 1688 px for a 390 by 844 viewport) is burned with the `pixelRatio` option set to 2 (`scripts/burn-trackxai.mjs --dpr 2`): the width classes and `display_width` read the CSS width (`780 / 2`), the bands, margins, text floors and the pixel text search double, the default scale is 2, and `scale: "auto"` gives `780 / display_width`, at least 2. Sidecar boxes are in the PNG's own pixels. `docsxai burn` sets `pixelRatio` from the `device_scale_factor` that `docsxai run --device-scale-factor` writes into `annotations.json`, so a workspace captured at 2x needs no flag.

Before this release the default scale was 1 at every pixel ratio, so a 2x capture's caption showed at half size: 14 px text read as 7 CSS px. A pack built from 2x captures with the old default changes once. `pack --check` against that pack reports the 2x images as changed and exits 1. Run `docsxai pack` and commit the new pack, or set `"scale": 1` in `burn.theme` to keep the old size.

## Line breaks

A burn with a theme balances the callout's lines. It keeps the line count that filling each line gives, then narrows the box to the smallest width in whole px that holds that count, so the lines come out about even. A one-letter word such as Spanish `a`, `y` or `o`, and the list number in front of the copy, stay on the line of the word after them. A word wider than the line, such as a path or a URL, breaks after `/`, `-`, `_`, `.` or `:` before it breaks between letters.

A burn without a theme fills each line, as it always did.

## Presets

Every preset sets every key except `font`. `clean`, `soft` and `high-contrast` leave `scale` at the pixel ratio, `font_weight` at 400, `arrow_size` at 8, `max_width_ratio` at 0.62, `display_width` at 720, `connector_style` at `auto` and `caption_style` at `full`.

| Key                    | `clean`                               | `soft`                                  | `high-contrast` |
| ---------------------- | ------------------------------------- | --------------------------------------- | --------------- |
| `accent`               | `#2563eb`                             | `#7c3aed`                               | `#d10000`       |
| `ink`                  | `#111827`                             | `#2e1065`                               | `#000000`       |
| `callout_background`   | `#ffffff`                             | `#faf5ff`                               | `#ffffff`       |
| `callout_border_color` | `#1f2937`                             | `#6d28d9`                               | `#000000`       |
| `callout_border_width` | 1                                     | 1                                       | 2               |
| `radius`               | 6                                     | 12                                      | 4               |
| `shadow`               | `0px 2px 8px 0px rgba(17,24,39,0.18)` | `0px 6px 18px 0px rgba(76,29,149,0.22)` | none            |
| `badge_shape`          | `rounded`                             | `circle`                                | `square`        |
| `badge_fill`           | `#1d4ed8`                             | `#6d28d9`                               | `#000000`       |
| `font_size`            | 14                                    | 14                                      | 15              |
| `line_height`          | 20                                    | 20                                      | 21              |
| `padding_x`            | 12                                    | 14                                      | 12              |
| `padding_y`            | 8                                     | 10                                      | 9               |

`high-contrast` is black text on a white callout (21:1) and white digits on a black badge (21:1).

`readable` is for docs sites. It sets `scale` to `"auto"` and `max_width_ratio` to 0.55, which limits every callout to 55% of the screenshot's width. It differs from the others in these keys:

| Key                    | `readable`                             |
| ---------------------- | -------------------------------------- |
| `accent`               | `#c2410c`                              |
| `ink`                  | `#111827`                              |
| `callout_background`   | `#fafafa`                              |
| `callout_border_color` | `#111827`                              |
| `callout_border_width` | 1                                      |
| `radius`               | 8                                      |
| `shadow`               | `0px 4px 12px 0px rgba(17,24,39,0.28)` |
| `badge_shape`          | `circle`                               |
| `badge_fill`           | `#9a3412`                              |
| `font_size`            | 15                                     |
| `line_height`          | 21                                     |
| `padding_x`            | 14                                     |
| `padding_y`            | 10                                     |
| `max_width_ratio`      | 0.55                                   |
| `scale`                | `auto`                                 |

Ink on the callout is 17:1 and the badge digits are 7.3:1. All four presets keep both text pairs at WCAG AA (4.5:1) or better, and a test checks that.

Any key in the block overrides the preset:

```json
{ "burn": { "theme": { "preset": "clean", "accent": "#0b6e4f", "radius": 2 } } }
```

## Tokens file

`from` names a JSON file inside the workspace. Two shapes are read:

- W3C design tokens: groups of `{ "$value": ..., "$type": ... }` leaves, with `{group.token}` aliases.
- A plain map, nested (`{ "color": { "accent": "#e8590c" } }`) or flat (`{ "color.accent": "#e8590c" }`).

Both flatten to dotted paths. Each theme key reads one default path:

| Theme key              | Default token path         | Value read                                                                                                     |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `accent`               | `color.accent`             | colour: hex string, or an object with a `hex` member                                                           |
| `ink`                  | `color.ink`                | colour                                                                                                         |
| `callout_background`   | `color.callout.background` | colour                                                                                                         |
| `callout_border_color` | `color.callout.border`     | colour                                                                                                         |
| `callout_border_width` | `border.callout.width`     | dimension: `2`, `"2px"`, `"0.125rem"` or `{ "value": 2, "unit": "px" }`                                        |
| `radius`               | `radius.callout`           | dimension                                                                                                      |
| `shadow`               | `shadow.callout`           | CSS shadow string, or a W3C shadow object (`color`, `offsetX`, `offsetY`, `blur`, `spread`), or a list of them |
| `badge_shape`          | `shape.badge`              | `circle`, `rounded` or `square`                                                                                |
| `badge_fill`           | `color.badge.background`   | colour                                                                                                         |
| `font_size`            | `font.size.caption`        | dimension                                                                                                      |
| `line_height`          | `font.line-height.caption` | dimension in px (a unitless multiplier such as `1.4` is refused)                                               |
| `padding_x`            | `space.callout.x`          | dimension                                                                                                      |
| `padding_y`            | `space.callout.y`          | dimension                                                                                                      |
| `font`                 | `font.file`                | path to a `.ttf` or `.otf`, relative to the workspace root                                                     |
| `font_weight`          | `font.weight.caption`      | `400` or `600`                                                                                                 |
| `connector_style`      | `shape.connector`          | `auto`, `line`, `chevron` or `arrow`                                                                           |
| `arrow_size`           | `size.callout.arrow`       | dimension                                                                                                      |

A `rem` is 16 px. A key whose default path the file does not define is left at the preset or default.

`caption_style`, `max_width_ratio`, `scale` and `display_width` are render settings with no design-token equivalent, so they have no default path. Set them in the `burn.theme` block, or point one at a token with `tokens`.

To read a key from a different path, map it in `tokens`:

```json
{
  "burn": {
    "theme": {
      "from": "design/tokens.json",
      "tokens": { "accent": "brand.primary", "ink": "brand.text" }
    }
  }
}
```

A key named in `tokens` must exist in the file. A missing one stops the command with:

```text
.docsxai.json burn.theme: ink: burn.theme.tokens maps it to "brand.text", but design/tokens.json has no such token
```

A tokens file that defines none of the default paths and maps none is an error too, since it is most likely the wrong file.

## Font

`font` points at a TTF or OTF file inside the workspace. Vendor the file in the workspace, next to the rest of the doc pack, so the output stays byte-stable: the burner reads that file and no system font. Without `font` the bundled Inter Regular is used.

The file is refused when it does not exist, is a symlink, is over 16 MiB, is a collection (`.ttc`), is a WOFF or WOFF2 file, or lacks the `head`, `hhea`, `hmtx` or `cmap` tables the burner measures with. One weight is used: the file's own. `font_weight` selects 400 or 600 and the file must be that weight, for example a semibold TTF with `font_weight: 600`. The bundled Inter is regular only, so `600` without a `font` prints a warning and the text stays 400.

In the interactive viewer the font is embedded in each flow page as a `data:` URI, and the page's content security policy gains `font-src data:` and nothing else. A page built without a font file keeps the policy it always had.

### Other scripts

A caption character takes the first font in this chain that has it:

1. `font`, or the bundled Inter (Latin, Greek, Cyrillic).
2. The `font_fallback` files, in the order written.
3. The bundled Noto Sans Arabic, Hebrew, Thai and Devanagari.

Arabic, Hebrew, Thai and Devanagari captions burn with no setup. A Chinese, Japanese or Korean font is 4.5 MB (Noto Sans JP) to 16 MB (all of Noto Sans CJK), so none ships: add one to `font_fallback`. For Japanese, download `NotoSansJP-Regular.otf` from the `Sans/SubsetOTF/JP` folder of [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) (SIL OFL 1.1), put it in the workspace and list it:

```json
{
  "burn": {
    "theme": {
      "font_fallback": ["fonts/NotoSansJP-Regular.otf"]
    }
  }
}
```

`NotoSansSC`, `NotoSansTC` and `NotoSansKR` in the folders next to it work the same way. A `.ttc` collection or a WOFF file is refused, as for `font`.

- The fallback files follow the rules of `font`: inside the workspace, at most 16 MiB each, no symlink.
- The bytes stay stable. Only the fallbacks a burn's captions use are loaded, in chain order, so a Latin caption burns exactly as it did without `font_fallback`.
- Each fallback is drawn at its own weight. With `font_weight: 600`, a regular fallback stays regular.
- A word wider than the line breaks between characters, never inside one. Thai breaks between dictionary words.
- `font_fallback` applies to burned images only. The interactive viewer uses the reader's browser fonts for other scripts.

### Right to left

A caption whose first letter is Arabic or Hebrew (also Syriac, Thaana or N'Ko) is set right to left: lines start at the right edge and the short last line ends there too. A Latin word or a number inside keeps its own order. Its numbered badge moves to the target's top-right corner and tries the right corners first. A caption that starts with a Latin letter stays left to right, whatever follows.

The connector joins the caption at the point nearest the target either way, so it doesn't change.

### Characters the font can't draw

Characters no font in the chain has would burn as empty boxes, so the burner checks every drawn caption first. A miss prints a warning naming the annotation and the script:

```text
burn: annotation "#login" on step "open": the caption has Katakana, Han characters the font can't draw (ロ グ 設 定), so they burn as empty boxes. Add a font that covers them to burn.theme.font_fallback
```

The image is still written. The report entry gets `missing_glyphs` with the Unicode script names (`["Katakana", "Han"]`; `Emoji` and `Symbols` for the rest). `docsxai burn --strict-glyphs` exits 1 when any caption has one, for CI. To fix it, add a font for the script to `font_fallback`, see [Other scripts](#other-scripts). Emoji have no fallback.

## Contrast

The burner and the viewer use the theme as written. `burn`, `pack` and `render` print a warning when a text pair falls under WCAG AA (4.5:1):

- `ink` on `callout_background`.
- White digits on `badge_fill`.

```text
burn: warning: burn.theme: ink on callout_background is 2.32:1, WCAG AA needs 4.5:1; the captions are harder to read than they should be
```

`font_weight: 600` without a `font` prints a warning too: the bundled Inter has no semibold.

The output is still produced.

A line connector picks its colour as [Placement with the line](#placement-with-the-line) describes. With `connector_style: "arrow"`, an arrow or stem is drawn solid in `callout_background` when a third or more of the pixels under it are dark (luma under 110), so it reads as the callout's tail. Where a tenth or more of the pixels under it are as light as that fill, it keeps the dark ink with a 2 px white outline instead. A light connector colour (a light `callout_border_color`) mirrors this: over pixels with luma 145 or more it takes a dark `callout_background`, or else gets a dark outline. A burn without a theme draws near-black ink (`#1c1c1c`) and adds the 2 px white outline over dark pixels.

## From a script

`burnWithWorkspaceTheme` reads the theme from `<workspace>/.docsxai.json` and burns with it:

```ts
import { burnWithWorkspaceTheme } from "@docsxai/viewer";

const png = await burnWithWorkspaceTheme({
  workspace: "/path/to/workspace",
  screenshotBuffer,
  annotations,
});
```

It returns what `burnAnnotations` returns and forwards `options` to it; an explicit `options.theme` wins over the workspace's. The theme is loaded once per workspace and kept for the process, keyed by the workspace path and the mtime of `.docsxai.json` (a changed tokens or font file needs a touch of the config). Contrast and font weight warnings go to `options.warn` (default `console.warn`) once per load. An invalid block throws a `BurnThemeError` with the file and the key list.

## Viewer variables

`docsxai render` appends one `:root` rule to each flow page. The stylesheet reads every variable with today's value as the fallback, so a page built without a theme looks as it did.

| Variable                                               | Theme value                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `--sd-accent`, `--sd-accent-glow`, `--sd-accent-pulse` | `accent`, and the same colour at 35% and 30% opacity              |
| `--sd-halo-radius`                                     | 4/7 of `radius`                                                   |
| `--sd-badge-fill`, `--sd-badge-radius`                 | `badge_fill`, and the radius of `badge_shape`                     |
| `--sd-callout-bg`, `--sd-callout-ink`                  | `callout_background`, `ink`                                       |
| `--sd-callout-border`, `--sd-callout-radius`           | `callout_border_width` and `callout_border_color`, `radius`       |
| `--sd-callout-shadow`, `--sd-callout-padding`          | `shadow`, `padding_y` and `padding_x`                             |
| `--sd-callout-font-size`, `--sd-callout-line-height`   | `font_size`, `line_height`                                        |
| `--sd-connector`                                       | arrow colour: `callout_border_color`, or `ink` without an outline |
| `--sd-font`                                            | the embedded font, when `font` is set                             |

Without a theme the live callout keeps its dark fill and white text while the burned one is white with dark text. Setting any `burn.theme` makes both use the theme's `callout_background` and `ink`.

## Errors

A block is checked as a whole and every problem is listed with its key:

```text
burn: .docsxai.json burn.theme has 3 problems:
  - accent: "red" is not a colour; use #rgb or #rrggbb
  - radius: 40 is outside the range 0 to 24
  - calloutBackground: not a known key (did you mean "callout_background"?); keys are preset, from, tokens, accent, ...
```

The command exits 1 and writes nothing.

## Not covered yet

- Before and after images. They need a CI artifact step; none exists, so this page shows none.
- Per-flow themes: one theme applies to the whole workspace.
