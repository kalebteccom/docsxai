# Theming burned captions

The halo, numbered badge, callout and arrow that `docsxai burn` and `docsxai pack` draw into a screenshot come from one theme. The interactive viewer (`docsxai render`) reads the same values through CSS variables, so a burned image and the live page show the same caption.

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

`burn`, `pack`, `pack --check` and `render` read it. `docsxai-viewer site` does not: the Starlight emitter takes its accent from `--accent` or the style artifact.

An optional tokens file fills the block (see [Tokens file](#tokens-file)).

## Layering

Four layers apply in this order, each one overriding the one before it:

1. The default look.
2. `preset`, when set.
3. The tokens file named by `from`, when set.
4. The keys written in the block.

The callout outline colour follows `ink` until a preset, the tokens file or the block sets `callout_border_color`.

## Keys

| Key                    | Type               | Range or values                                 | Default           | What it sets                                                          |
| ---------------------- | ------------------ | ----------------------------------------------- | ----------------- | --------------------------------------------------------------------- |
| `preset`               | string             | `clean`, `soft`, `high-contrast`, `readable`    | none              | A built-in look, see [Presets](#presets).                             |
| `from`                 | string             | path to a `.json` file inside the workspace     | none              | The tokens file.                                                      |
| `tokens`               | object             | theme key to token path                         | none              | Reads a key from another path, and requires it to exist.              |
| `accent`               | colour             | `#rgb` or `#rrggbb`                             | `#e8590c`         | Halo outline. Its glow is the same colour at 35% opacity.             |
| `ink`                  | colour             | `#rgb` or `#rrggbb`                             | `#1c1c1c`         | Callout text.                                                         |
| `callout_background`   | colour             | `#rgb` or `#rrggbb`                             | `#fff`            | Callout fill.                                                         |
| `callout_border_color` | colour             | `#rgb` or `#rrggbb`                             | the `ink` colour  | Callout outline, and the arrow and stem that join it to its target.   |
| `callout_border_width` | number             | 0 to 6 px                                       | `1`               | Callout outline width. 0 draws no outline and the arrow uses `ink`.   |
| `radius`               | number             | 0 to 24 px                                      | `7`               | Callout corner radius. The halo's radius is 4/7 of it.                |
| `shadow`               | string             | CSS `box-shadow`, up to 3 layers, or `none`     | `none`            | Callout shadow. Layers are `<x> <y> [<blur> [<spread>]] <colour>`.    |
| `badge_shape`          | string             | `circle`, `rounded`, `square`                   | `circle`          | Badge corners: a pill, 6 px, or square.                               |
| `badge_fill`           | colour             | `#rgb` or `#rrggbb`                             | `#c2410c`         | Badge fill. Its digits and outline are white.                         |
| `font_size`            | number             | 8 to 32 px                                      | `14`              | Callout text size.                                                    |
| `line_height`          | number             | 8 to 64 px, at least `font_size`                | `19`              | Callout line pitch.                                                   |
| `padding_x`            | number             | 0 to 40 px                                      | `11`              | Callout horizontal padding.                                           |
| `padding_y`            | number             | 0 to 40 px                                      | `8`               | Callout vertical padding.                                             |
| `font`                 | string             | path to a `.ttf` or `.otf` inside the workspace | the bundled Inter | Callout and badge font, see [Font](#font).                            |
| `font_weight`          | number             | `400` or `600`                                  | `400`             | Callout text weight. The font file must have it, see [Font](#font).   |
| `arrow_size`           | number             | 4 to 24 px                                      | `8`               | Arrow length. Its base is 7/4 of that wide.                           |
| `max_width_ratio`      | number             | 0.2 to 1                                        | `0.62`            | Widest callout as a share of the screenshot, see [Scale](#scale).     |
| `scale`                | number or `"auto"` | 0.5 to 4, or `auto`                             | `1`               | Multiplies every caption dimension, see [Scale](#scale).              |
| `display_width`        | number             | 240 to 2400 px                                  | `720`             | CSS px the screenshot is shown at. Read by `scale: "auto"`.           |

Numbers are plain values without a unit: px for sizes, a share for `max_width_ratio`, a factor for `scale`. Colours are stored as lowercase `#rrggbb`.

## Scale

A screenshot wider than the column it is shown in gets scaled down by the page, and the caption drawn into it shrinks with it. A 1440 px screenshot in a 720 px column shows 14 px text at 7 px.

`scale` multiplies every caption dimension: text size, line height, padding, outline, radius, shadow, arrow, badge, halo and the callout's width. The layout (which side the callout takes, where it slides) is decided at base size and then multiplied, so a scaled caption sits where the unscaled one would.

- A number such as `1.5` or `2` is used as written.
- `"auto"` uses `max(1, screenshot width / display_width)`, at most 4, so a screenshot wider than its column gets a larger caption and a narrower one keeps base size. A 1440 px screenshot with the default `display_width` of 720 gives 2. A 390 px screenshot gives 1.

`display_width` is the width in CSS px the page shows the screenshot at. It only matters for `"auto"`.

When the page shows the screenshot at `displayWidth` CSS px, a caption length ends up on screen as:

```text
onscreen = fontSize * auto * (displayWidth / imageWidth)
```

With `auto = imageWidth / displayWidth` that is `fontSize` itself, so `readable` text is 15 px, badge digits 12 px and the halo outline 2 px. A 1440 px screenshot shown at 720 px gives auto 2 and a display factor of 0.5. A 780 px phone screenshot shown at 358 px needs `display_width: 358`: auto is 2.18 (rounded up to 2 decimals) and the display factor 0.46. With the default 720 that screenshot gets auto 1.08 and 15 px text shows at 7.5 px. The cap of 4 covers a 1440 px screenshot shown at 360 px; a screenshot more than 4 times its display width shows captions under base size.

`max_width_ratio` limits the callout's outer width to that share of the screenshot. At the default 0.62 it only applies when obstacles limit the callout, and callouts otherwise stop at 280 px at base size. A ratio under 0.62 applies to every callout. The callout sits beside its target and moves along the edge, so it covers the target only when no side of the screenshot has room for it.

`scale`, `arrow_size` and `max_width_ratio` apply to burned images. The interactive viewer shows the screenshot at its own size and keeps its arrow, so it reads `font_weight` and the other keys but not these three.

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

Screenshots narrower than `display_width` keep base size, so one block serves mobile captures and wide desktop ones.

## Presets

Every preset sets every key except `font`. `clean`, `soft` and `high-contrast` keep `scale` at 1, `font_weight` at 400, `arrow_size` at 8, `max_width_ratio` at 0.62 and `display_width` at 720.

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

`readable` is for docs sites. It sets `scale` to `"auto"`, `max_width_ratio` to 0.55 (callouts stay under 60% of the screenshot's width) and differs from the others in these keys:

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

Ink on the callout is 16:1 and the badge digits are 7:1. All four presets keep both text pairs at WCAG AA (4.5:1) or better, and a test checks that.

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
| `arrow_size`           | `size.callout.arrow`       | dimension                                                                                                      |

A `rem` is 16 px. A key whose default path the file does not define is left at the preset or default.

`max_width_ratio`, `scale` and `display_width` are render settings with no design-token equivalent, so they have no default path. Set them in the `burn.theme` block, or point one at a token with `tokens`.

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

The file is refused when it is missing, a symlink, over 16 MiB, a collection (`.ttc`), a WOFF or WOFF2 file, or lacks the `head`, `hhea`, `hmtx` or `cmap` tables the burner measures with. One weight is used: the file's own. `font_weight` selects 400 or 600 and the file must be that weight, for example a semibold TTF with `font_weight: 600`. The bundled Inter is regular only, so `600` without a `font` prints a warning and the text stays 400.

In the interactive viewer the font is embedded in each flow page as a `data:` URI, and the page's content security policy gains `font-src data:` and nothing else. A page built without a font file keeps the policy it always had.

## Contrast

The burner and the viewer use the theme as written. `burn`, `pack` and `render` print a warning when a text pair falls under WCAG AA (4.5:1):

- `ink` on `callout_background`.
- White digits on `badge_fill`.

```text
burn: warning: burn.theme: ink on callout_background is 2.32:1, WCAG AA needs 4.5:1; the captions are harder to read than they should be
```

`font_weight: 600` without a `font` prints a warning too: the bundled Inter has no semibold.

The output is still produced.

An arrow or stem over a dark part of a screenshot gets a white outline, as before. A light connector colour (a light `callout_border_color`) mirrors that: it gets a dark outline over light pixels.

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
