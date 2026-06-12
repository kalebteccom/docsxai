# docsxai brand kit

The official docsxai mark and its derived assets. The vector mark is the
source of truth; the raster files are generated from it by
[`render.py`](./render.py) (favicons + marks) and [`hig.py`](./hig.py)
(halo app icons + Icon Composer layers).

## The mark

A pair of orbiting arcs around a dog-eared page, with an annotation halo —
a dot in a ring — seated in the upper-right arc gap: a captured page in
orbit, annotated. The glyph is monochrome; on icons it sits on an amber
"halo" tile with a soft glass treatment.

docsxai is part of the **xai family** alongside browxai and remotxai —
same orbital arc structure, different palette and inner glyph. The browxai
mark uses a cursor-kite for a browser in motion; the remotxai mark uses a
signal ring for a remote control loop; the docsxai mark uses a dog-eared
page with an annotation halo for documentation drawn from a live site.

## Palette (halo)

| Token       | Hex / rgba               | Use                                  |
| ----------- | ------------------------ | ------------------------------------ |
| Halo deep   | `#381C04`                | Top of the icon gradient             |
| Halo bright | `#B45309`                | Bottom of the icon gradient          |
| Tile top    | `#92400E`                | Tile favicon gradient top            |
| Tile bottom | `#D97706`                | Tile favicon gradient bottom         |
| Amber glow  | `rgba(251,191,36,0.30)`  | Upper-right radial glow on app icons |
| Ink top     | `rgba(255,255,255,0.92)` | Top stop of glass mark ink           |
| Ink bottom  | `rgba(255,255,255,0.55)` | Bottom stop of glass mark ink        |
| White       | `#FAFAF7`                | The mark on dark surfaces            |
| Ink         | `#16161A`                | The mark on light surfaces           |

The documentation site (`website/`) carries this palette: an amber accent
and glass / halo surfaces. The mark stays monochrome in the header.

## Files

| File                                     | What it is                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docsxai-mark.svg`                       | The glyph using `currentColor`.                                                                |
| `docsxai-mark-black.svg` / `-white.svg`  | The glyph in ink / white, for light / dark surfaces.                                           |
| `docsxai-favicon.svg`                    | Tile favicon: amber gradient square + white glyph (page lines dropped for small-size clarity). |
| `favicon.ico`                            | Multi-resolution ICO (16/32/48).                                                               |
| `favicon-16.png` / `-32.png` / `-48.png` | Raster favicons.                                                                               |
| `apple-touch-icon.png`                   | 180px touch icon (the tile).                                                                   |
| `docsxai-halo-fullbleed-1024.png`        | App-store icon master: glass glyph on the full-bleed halo field.                               |
| `docsxai-glass-halo-1024.png`            | Squircle marketing preview (Mac-dock margin + edge highlight).                                 |
| `docsxai-avatar-512.png`                 | Social / GitHub-org avatar (white mark on near-black).                                         |
| `icon-composer-layers/`                  | Flat background + flat glyph for Apple Icon Composer (no baked fx).                            |
| `halo-preview.png`                       | Reference render of the halo set (fullbleed / squircle / avatar).                              |
| `xai-family-preview.png`                 | Three-wide comparison with browxai + remotxai (rendered when siblings exist).                  |
| `render.py`                              | Regenerates the favicons + standalone marks.                                                   |
| `hig.py`                                 | Regenerates the halo app icons (palette lives in its `V` dict).                                |

## Regenerating

```sh
pip install cairosvg pillow
python3 brand/render.py   # favicons + marks
python3 brand/hig.py      # halo app icons + Icon Composer layers
```

`hig.py` also renders `xai-family-preview.png` when both sibling glass
icons are reachable. By default it looks for them at
`../../browxai/brand/browxai-glass-aurora-1024.png` and
`../../remotxai/brand/remotxai-glass-signal-1024.png` (siblings under
`Kalebtec/`); override with the `BROWXAI_GLASS` / `REMOTXAI_GLASS` env vars.

## Where these are used

The documentation site consumes the mark and favicons:

- `website/src/assets/docsxai-tile.svg` — the header logo (the tile favicon).
- `website/public/favicon.svg`, `favicon.ico`, `favicon-16.png`,
  `favicon-32.png`, `apple-touch-icon.png` — the tile favicons.

When the brand changes, update the source SVGs here, run the scripts, then
copy the relevant files into `website/`.
