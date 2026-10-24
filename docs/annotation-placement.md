# Placing burned annotations

`docsxai burn` and `docsxai pack` put each callout next to its target and join the two with a connector. This page covers the record fields that steer where it lands, and what to do when it lands badly. Colours, fonts and sizes are in [Theming burned captions](burn-theming.md).

## What an annotation record holds

Records live in `annotations.json` (`docsxai/annotations@1`), one per annotated element. The burner reads these keys:

| Key            | What it does                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bounding_box` | The target, in screenshot pixels. Without it the annotation is skipped with a warning.                                             |
| `copy`         | The callout text. Without it only the halo and badge are drawn.                                                                    |
| `index`        | 1-based number on the badge. Set only when a screenshot has more than one annotation.                                              |
| `arrow_style`  | A soft side hint: `top`, `bottom`, `left`, `right`, or a corner such as `top-left`. The part before the dash names the side.       |
| `nudge`        | `{ x, y }` px added to callout and connector after placement. The halo stays put.                                                  |
| `obstacles`    | Up to 40 boxes of page content to keep clear, in screenshot pixels.                                                                |
| `placement`    | `inside`, `side`, `align`, `pin_arrow` and `max_width` (120 to 560 px). `obstacle_radius` and `obstacle_limit` steer capture only. |

A box that lies off the image, has zero or negative size, or holds `NaN` or infinity is skipped the same way. A box that only overhangs an edge is clipped to the image. A skipped annotation names its selector and step in the warning and appears in `burn --report` with a `skipped` reason.

With `annotations.obstacles` on in `.docsxai.json`, `docsxai run` records `obstacles` for you. A pipeline that knows the layout can write them by hand. The interactive viewer ignores `obstacles` and `placement`.

## Side hints

The preferred side is `placement.side`, else the side in `arrow_style`, else `top`.

- With no `obstacles` and no `placement` key, the burner puts the callout on the preferred side if it fits inside the image, then tries the others.
- With `obstacles` or a `placement` key, the burner scores positions on all four sides. Both `arrow_style` and `placement.side` earn a bonus for their side. When that side is clear it wins. A small overlap does not stop it: the bonus outweighs about 2 px of content along the callout's width. A side that covers more than that, or has no room, loses.
- `placement.side` goes further. The burner tries only that side first, and falls back to the others when nothing fits inside the image. A themed burn with the line connector also falls back when that side only offers spots that cover content.

## Obstacles

List the neighbours of the target: text blocks, logos, icons, other halos. Do not list the target. A box that contains the target cannot be avoided.

The burner moves the callout out along the side, joins it to the target with a stem, and slides it along the target's edge. With a theme the connector is a thin line instead: the callout moves up to 176 px out to empty space, or docks 12 px from the top or bottom edge of the image, and text found in the screenshot's pixels counts as an obstacle (see [Placement with the line](burn-theming.md#placement-with-the-line)). It keeps the spot that covers the least. A stem that crosses content costs more than a callout that covers the same area. Other halos, badges and earlier callouts count as obstacles too.

When no spot is clear:

1. It tries narrower callouts, down to 168 px. That applies on a narrow image, where the widest callout (the smaller of 280 px and `max_width_ratio`, 0.62 by default, of the image width) is under 280 px, and whenever `placement.max_width` is set.
2. It cuts the callout's side padding by up to 6 px, never below 8 px, and keeps that box if it fits clear.
3. Otherwise it draws the spot with the least overlap, the widest among equals.

With the line connector the burner also tries a box up to 560 px wide, and text one step smaller (16 px burned, or 14 px under 900 px wide), before it accepts an overlap.

`docsxai burn <workspace-dir> --report report.json` lists each callout's `overlap_ratio` and flags `unplaceable` above 0.1. `docsxai-viewer burn` takes `--max-overlap` to move that threshold.

## Routing the line

With the line connector, a caption that covers nothing can still have a line that crosses text when every side of the target is crowded. The burner then reroutes it:

1. It looks for a caption spot whose straight line crosses no obstacle, other halo, badge or earlier caption, on every side, distance and slide along the target's edge. A clean spot on the hinted side (`placement.side` or `arrow_style`) wins, with `nudge` applied and `placement.align` as the resting point. Otherwise the shortest line wins.
2. Otherwise it draws the line with one right-angle elbow: out from one edge of the target, then along to the caption, both legs clear. The shortest such line wins. An elbow ignores `nudge`. Its own badge may sit on it.
3. Otherwise the line stays where the planner put it, and `caption_style: "auto"` falls back to the badge as before.

A rerouted caption is kept only when it covers no more than the first one did. The burn report gives each annotation of a line burn `route` (`straight`, `elbow`, or `none` when no line is drawn) and `connector_crossings`, the number of boxes the drawn line still crosses (0 once routed). A burn without a theme draws the triangle and is not rerouted.

## The badge

With the line connector, a numbered badge sits 1 px off a corner of the target, as [Clean halo and badge](burn-theming.md#clean-halo-and-badge) describes.

With the `arrow` connector it sits 8 px up and left of the halo. When the annotation has `obstacles`, the burner also tries the other three corners and offsets of 14, 20 and 26 px, and keeps the one that covers the least content, then the least of the target. With obstacles the badge ends fully inside the image, 2 px from each edge. Without them it is clamped by its 22 px inner circle, so the white border can touch the edge.

## Scale and display_width

A screenshot wider than its column shrinks, and the caption shrinks with it. `scale` multiplies every caption dimension, and `"auto"` uses `max(1, imageWidth / display_width)`, at most 4. On the page a length ends up as:

```text
on-screen px = fontSize x auto x displayWidth / imageWidth
```

A 1440 px capture shown at 720 px gets auto 2. With `auto = imageWidth / displayWidth` the text shows at `fontSize`. Set `display_width` to the column width, or to `{ default, narrow, narrow_below }` when narrow images are shown at a different width. Screenshots narrower than it keep base size. The `readable` preset turns on `scale: "auto"`.

`device_scale_factor` in `annotations.json` feeds the burn pixel ratio, so `docsxai burn` needs no flag for a 2x workspace; [Phone captures](burn-theming.md#phone-captures) explains how the ratio sets the sizes.

## Wide and narrow images in one workspace

A `.docsxai.json` holds one `burn.theme`. Per-flow themes are not supported. For wide and narrow images in one workspace, give `display_width` an object: `"display_width": { "default": 720, "narrow": 358, "narrow_below": 900 }` uses 358 for screenshots narrower than 900 px and 720 for the rest (see [burn-theming.md](burn-theming.md#wide-and-narrow-images)). For other per-image changes, pass `options.theme` per call. It wins over the workspace's block. `burnWithWorkspaceTheme` caches the workspace load, so the base theme is read once.

```ts
import {
  burnWithWorkspaceTheme,
  loadBurnTheme,
  DEFAULT_BURN_THEME,
  type BurnTheme,
} from "@docsxai/viewer";

const base = (await loadBurnTheme(workspace))?.theme ?? DEFAULT_BURN_THEME;
const theme: BurnTheme = imageWidth < 600 ? { ...base, scale: "auto", displayWidth: 358 } : base;
const png = await burnWithWorkspaceTheme({
  workspace,
  screenshotBuffer,
  annotations,
  options: { theme },
});
```

`options.theme` takes the resolved `BurnTheme`, so its keys are camelCase (`displayWidth`, `displayWidthNarrow`, `narrowBelow`, `fontSize`).

## Troubleshooting

| Symptom                             | Fix                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Callout covers text                 | Add that text's box to `obstacles`, or shorten `copy`.                            |
| Connector crosses content           | Check `connector_crossings` in the report, then give a side hint on a clear side. |
| Callout sits on the wrong side      | Set `placement.side` to try only that side first.                                 |
| Badge covers neighbouring text      | Add those boxes to `obstacles` so the badge can pick another corner.              |
| Badge touches the image edge        | Add at least one box to `obstacles`. The badge then stays 2 px inside.            |
| Captions too small on the page      | Set `display_width` to the column width and `scale` to `"auto"`.                  |
| Callout too wide for a narrow image | Lower `placement.max_width`, or `max_width_ratio` in the theme.                   |
| No clear spot for a caption         | Set `caption_style` to `auto` (badge when no spot is clear) or `badge`.           |

> **For agents:** to check a side hint against a raw capture before committing it, run `node scripts/burn-probe.mjs --screenshot raw.png --annotations raw.json` from a docsxai checkout after `pnpm --filter @docsxai/viewer build`. It prints, per callout, the side asked for and the side taken, each side's best score, the obstacles the callout, arrow, stem and badge touch, and how the connector is painted: ink, fill or outline for the arrow, the colour for the line. `--side 2=bottom` tries a hint without editing the file, `--theme` or `--workspace` burns with a theme, and `--out` writes the burned PNG.
