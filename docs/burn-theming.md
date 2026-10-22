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

| Key                    | Type   | Range or values                                 | Default           | What it sets                                                        |
| ---------------------- | ------ | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `preset`               | string | `clean`, `soft`, `high-contrast`                | none              | A built-in look, see [Presets](#presets).                           |
| `from`                 | string | path to a `.json` file inside the workspace     | none              | The tokens file.                                                    |
| `tokens`               | object | theme key to token path                         | none              | Reads a key from another path, and requires it to exist.            |
| `accent`               | colour | `#rgb` or `#rrggbb`                             | `#e8590c`         | Halo outline. Its glow is the same colour at 35% opacity.           |
| `ink`                  | colour | `#rgb` or `#rrggbb`                             | `#1c1c1c`         | Callout text.                                                       |
| `callout_background`   | colour | `#rgb` or `#rrggbb`                             | `#fff`            | Callout fill.                                                       |
| `callout_border_color` | colour | `#rgb` or `#rrggbb`                             | the `ink` colour  | Callout outline, and the arrow and stem that join it to its target. |
| `callout_border_width` | number | 0 to 6 px                                       | `1`               | Callout outline width. 0 draws no outline and the arrow uses `ink`. |
| `radius`               | number | 0 to 24 px                                      | `7`               | Callout corner radius. The halo's radius is 4/7 of it.              |
| `shadow`               | string | CSS `box-shadow`, up to 3 layers, or `none`     | `none`            | Callout shadow. Layers are `<x> <y> [<blur> [<spread>]] <colour>`.  |
| `badge_shape`          | string | `circle`, `rounded`, `square`                   | `circle`          | Badge corners: a pill, 6 px, or square.                             |
| `badge_fill`           | colour | `#rgb` or `#rrggbb`                             | `#c2410c`         | Badge fill. Its digits and outline are white.                       |
| `font_size`            | number | 8 to 32 px                                      | `14`              | Callout text size.                                                  |
| `line_height`          | number | 8 to 64 px, at least `font_size`                | `19`              | Callout line pitch.                                                 |
| `padding_x`            | number | 0 to 40 px                                      | `11`              | Callout horizontal padding.                                         |
| `padding_y`            | number | 0 to 40 px                                      | `8`               | Callout vertical padding.                                           |
| `font`                 | string | path to a `.ttf` or `.otf` inside the workspace | the bundled Inter | Callout and badge font, see [Font](#font).                          |

Numbers are plain px values without a unit. Colours are stored as lowercase `#rrggbb`.

## Presets

Every preset sets every key except `font`.

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

`high-contrast` is black text on a white callout (21:1) and white digits on a black badge (21:1). All three presets keep both text pairs at WCAG AA (4.5:1) or better, and a test checks that.

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

A `rem` is 16 px. A key whose default path the file does not define is left at the preset or default.

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

The file is refused when it is missing, a symlink, over 16 MiB, a collection (`.ttc`), a WOFF or WOFF2 file, or lacks the `head`, `hhea`, `hmtx` or `cmap` tables the burner measures with. Only the regular weight is used.

In the interactive viewer the font is embedded in each flow page as a `data:` URI, and the page's content security policy gains `font-src data:` and nothing else. A page built without a font file keeps the policy it always had.

## Contrast

The burner and the viewer use the theme as written. `burn`, `pack` and `render` print a warning when a text pair falls under WCAG AA (4.5:1):

- `ink` on `callout_background`.
- White digits on `badge_fill`.

```text
burn: warning: burn.theme: ink on callout_background is 2.32:1, WCAG AA needs 4.5:1; the captions are harder to read than they should be
```

The output is still produced.

An arrow or stem over a dark part of a screenshot gets a white outline, as before. A light connector colour (a light `callout_border_color`) mirrors that: it gets a dark outline over light pixels.

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
- A bold weight, and per-flow themes: one theme applies to the whole workspace.
