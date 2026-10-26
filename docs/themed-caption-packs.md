# Themed caption packs

This page takes raw captures from `docsxai run` to a folder of burned, hash-named screenshots with a manifest: your brand colours, light and dark, desktop and phone. [Theming burned captions](burn-theming.md) lists every theme key and [Placing burned annotations](annotation-placement.md) covers how callouts choose a side. This page gives the order to do things in, and what to look at when a caption lands somewhere you don't like.

`connector_style`, `caption_style` and the two scripts used below are new in the next release. The scripts live in `scripts/` of a docsxai checkout and aren't in the npm packages, so run them from one:

```sh
pnpm install
pnpm --filter @docsxai/viewer build
```

The WebP twins need `cwebp` (`brew install webp`).

## 1. From raw captures to a pack

The pipeline is four steps: capture, burn once per colour scheme, make the WebP twins, publish the folder.

**Capture.** Turn on obstacles in the workspace's `.docsxai.json`, so every annotation record lists the text boxes near its target:

```json
{ "annotations": { "obstacles": true } }
```

`docsxai run ~/docsxai/my-app` then leaves a clean screenshot and an `annotations.json` per flow (one per variant directory for a matrix flow). The burn script reads a flat folder instead: one PNG and one sidecar per screenshot, named `<screen>.<locale>.<theme>.<width>.png` and `.json`. Writing the step that copies each step's records into a sidecar is yours.

```text
raw/
  board.en.dark.1280.png
  board.en.dark.1280.json
  board.en.dark.390.png
  board.en.dark.390.json
  board.en.light.1280.png
  ...
```

`<theme>` is `light` or `dark`. `<screen>` is lowercase letters, digits and hyphens. A sidecar looks like this:

```json
{
  "schema": "trackxai/raw-capture-sidecar@1",
  "step": "board",
  "viewport": { "width": 390, "height": 844 },
  "annotations": [
    {
      "selector": "h1.page__title",
      "copy": "Pick a ticket to open its detail",
      "index": 1,
      "bounding_box": { "x": 16, "y": 60, "width": 46, "height": 26 },
      "obstacles": [{ "x": 16, "y": 5, "width": 48, "height": 33 }]
    }
  ]
}
```

`copy` and `selector` are required on every annotation. An annotation with no `bounding_box` is skipped with a warning. `viewport.width` must match the width in the file name, and `viewport.height` feeds the phone checks in [section 4](#4-reading-the-burn-report). The script checks the schema id above, so an app with its own sidecar format copies the script and changes `SIDECAR_SCHEMA` in `scripts/burn-trackxai-plan.mjs`.

**Burn.** Run the script once per colour scheme into the same `--out`. Each run takes the raws whose name carries that scheme, burns them with `examples/burn-theme/trackxai-<theme>.tokens.json` and merges `manifest.json` in `--out`:

```sh
node scripts/burn-trackxai.mjs --raw raw --out web/public/screens --theme light --rename ticket=ticket-detail
node scripts/burn-trackxai.mjs --raw raw --out web/public/screens --theme dark --rename ticket=ticket-detail
```

- A PNG lands at `<out>/<desktop|mobile>-<width>/<name>.<hash8>.png`. The folder is `desktop-` from 900 px wide and `mobile-` under it. `<hash8>` is the first 8 hex digits of the PNG's SHA-256, and `<name>` is the screen after `--rename`.
- The same input gives the same names. When a capture changes, the old PNG and its `.webp` twin are deleted and stderr says `removed <path> and its .webp twin`. `--keep-superseded` leaves them, for a tree where they're tracked.
- The manifest keeps every screen, variant and `alt` the run didn't touch. `--manifest-in <file>` merges into a manifest kept somewhere else.
- Two screens that burn to the same bytes with the same callouts share one file.
- Other flags: `--locale` (default `en`), `--widths` (default `1280,390`), `--screens a,b` to burn only those, `--compare <dir>` to also write `before-` and `after-` PNGs, and `--badge-only` with `--overrides`, covered in [section 3](#3-connector_style-and-caption_style).

Every flag has a line in the script's header. The tokens file names are fixed to `trackxai-light` and `trackxai-dark`, so an app with its own pair copies the script and edits `themeFor`.

**WebP twins.** The script writes PNGs only. Make the twins after both burns, with the same stem so one name covers both:

```sh
for f in web/public/screens/*/*.png; do
  cwebp -lossless -z 9 -quiet "$f" -o "${f%.png}.webp"
done
```

Lossless keeps the pixels identical to the PNG. The hash comes from the PNG, so a changed PNG always gets a new twin name too. On the page:

```html
<picture>
  <source srcset="/screens/mobile-390/board.fba4c7cb.webp" type="image/webp" />
  <img src="/screens/mobile-390/board.fba4c7cb.png" width="390" height="844" alt="The board" />
</picture>
```

**The manifest** is `docsxai/screens-pack@1`. `src`, `width`, `height` and `bytes` describe the PNG, and `callouts` holds the copy in badge order:

```json
{
  "schema": "docsxai/screens-pack@1",
  "screens": {
    "board": {
      "variants": {
        "en.dark.390": {
          "src": "/screens/mobile-390/board.fba4c7cb.png",
          "width": 390,
          "height": 844,
          "bytes": 20943,
          "callouts": ["Pick a ticket to open its detail", "Status changes appear here"]
        }
      }
    }
  }
}
```

`docsxai pack` writes `docsxai/screens-pack@2` ([manifest reference](pack-manifest.md)), and `convertScreensPackV1` in `@docsxai/viewer` turns this one into it.

**If one theme is enough**, skip the script. `docsxai pack` burns every step of a workspace with its `burn.theme`, optimises with `oxipng` (or skips it with `--no-optimise`), hash-names the PNGs and writes the `@2` manifest. It has no WebP step, and a workspace holds one `burn.theme`, so light and dark with different tokens files need the script or two workspaces:

```sh
docsxai pack ./docs-workspace --out web/public/screens
docsxai pack ./docs-workspace --check --against web/public/screens
```

`pack --from-raw` reads no `.docsxai.json`, so it burns the default look.

## 2. Sizes per width class

A 1280 px screenshot shown 1100 px wide shrinks to 86% of its size, and the caption shrinks with it. `scale: "auto"` makes the burned caption larger by `max(1, image width / display_width)` (at most 4), so the text ends up at the theme's `font_size` on the page:

```text
on-screen px = font_size x auto x displayWidth / imageWidth
```

For the `trackxai-*` example pair, `font_size` is 15 and the page shows desktop shots at about 1100 px and phone shots at about 350:

| Capture | Shown at | `auto` | Burned text | On the page |
| ------- | -------- | ------ | ----------- | ----------- |
| 1280    | 1100     | 1.17   | 17.6 px     | 15 px       |
| 390     | 350      | 1.12   | 16.8 px     | 15 px       |

One number can't serve both. `display_width: 1100` leaves the 390 capture at `auto` 1, which shows 13.5 px text. `display_width: 350` pushes the 1280 capture to `auto` 3.66, which shows 47 px text. The object form picks the width by image size:

```json
{
  "burn": {
    "theme": {
      "preset": "readable",
      "display_width": { "default": 1100, "narrow": 350, "narrow_below": 900 }
    }
  }
}
```

A capture narrower than `narrow_below` (900 by default) uses `narrow`, any other uses `default`. The example tokens files carry `scale` and `display_width` under `render`, which has no default token path, so map them:

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

To find the widths, read the rendered `<img>` width in the browser at each breakpoint of your docs page (`$0.clientWidth` in the console after selecting the image). Burn again when the layout changes. A number written as `scale` (`1.5`) ignores `display_width`. The key reference is [Scale](burn-theming.md#scale) and [Wide and narrow images](burn-theming.md#wide-and-narrow-images).

## 3. `connector_style` and `caption_style`

`connector_style` sets what joins a caption to its target:

- `line`: a 2 px line with a dot at the target's ring. This is what `auto` gives a themed burn, and both example tokens files set it.
- `chevron`: the same line ending in an open chevron.
- `arrow`: the filled triangle and stem docsxai always drew, which is also what `auto` gives a burn with no theme.

`caption_style` decides whether each annotation gets a caption box at all. It applies to the line and chevron connectors:

- `full`: every annotation gets a caption. When no spot is clear, the caption that covers the least is drawn anyway, and the burn report flags it `unplaceable`.
- `badge`: no captions. Each target gets its ring and a numbered badge.
- `auto`, the default at every width: a caption where a clean one exists, else the badge. Desktop captures with no clear spot show their badge only; set `caption_style: "full"` to keep the old behaviour.

**When `auto` falls back.** For each annotation the burner tries the caption at the theme's size, then a wide box up to 560 px (fewer lines), then both again with the text one step smaller, down to 14 px burned text on a phone capture and 16 px from 900 px wide. It keeps the first caption that covers no listed or detected text, no other target, halo, badge or caption (and on a phone capture no header, bottom nav, floating button or 16 px side strip), and whose line crosses no text. If none qualifies, that annotation gets the ring and the badge and nothing else. The caption goes, and the connector with it.

```json
{
  "burn": {
    "theme": {
      "from": "trackxai-dark.tokens.json",
      "caption_style": "auto"
    }
  }
}
```

The script sets it by width and needs no key: captures under 900 px burn with `auto` and the others with `full`. `--badge-only board.390,ticket.en.dark.390` (and the `badge_only` list of `scripts/burn-trackxai.overrides.json`, or the file named by `--overrides`) force a frame to badges. An entry is `<screen>.<width>` for every locale and scheme, or `<screen>.<locale>.<theme>.<width>`.

**Print a legend when badges can appear.** A badge-only annotation has no text in the image. The manifest doesn't record which frames fell back, so put an ordered list under every phone capture (or every capture, if you like it consistent) built from `callouts`:

```js
const variant = manifest.screens.board.variants["en.dark.390"];
const legend = document.createElement("ol");
for (const copy of variant.callouts) {
  const item = document.createElement("li");
  item.textContent = copy;
  legend.append(item);
}
```

The badge digit is the annotation's `index`, or its place in the list when it has none. The list numbers match when indexes run from 1 without gaps. In an `@2` manifest each callout carries its `index`, so print that.

## 4. Reading the burn report

There are three places to look, from coarse to fine.

**The script's stderr.** A clean run prints nothing. Otherwise:

```text
check: board.en.dark.390.png: badge 1 covers 187 px² of listed text
badge only: board.en.dark.390.png: annotation 1, 2
```

`check:` lines list what a drawn caption or badge still covers: listed text, another annotation's target, another caption or badge, and on a phone capture the header or bottom nav. `badge only:` names the annotations that fell back. The script exits 0 either way.

**`docsxai burn <workspace> --report burn-report.json`** (a relative path lands under the workspace root) writes `docsxai/burn-report@1`, one entry per annotation. It's the final word on where each caption landed:

```json
{
  "step": "board",
  "index": 1,
  "selector": "#a",
  "mode": "outside",
  "side": "top",
  "callout": { "x": 90.87, "y": 202.78, "width": 226.18, "height": 25.86 },
  "badge": { "x": 0, "y": 229.76, "width": 29.12, "height": 29.12 },
  "obstacle_overlap": 2871,
  "other_overlap": 0,
  "overlap_ratio": 0.491,
  "unplaceable": true
}
```

- `callout` and `badge` are boxes in screenshot pixels. `callout` is `null` when no caption was drawn.
- `obstacle_overlap` is the px² the caption, arrow and line cover of listed text, and `other_overlap` the px² on other halos, badges and captions. `overlap_ratio` is both as a share of the caption's area, and `unplaceable` is `true` above 0.1. `docsxai-viewer burn --max-overlap <ratio>` moves the threshold.
- A fallback shows as `"mode": "none"`, `"callout": null` and `"caption_style": "badge"`. It doesn't count as `unplaceable`, so a build that only watches that count misses it.
- `route` (line connector only) is `straight`, `elbow` or `none`, and `connector_crossings` counts the boxes the drawn line still crosses (0 once routed). Not in `0.3.0-rc.3`.

In a themed burn the burner checks each listed box against the pixels first and drops a box with nothing drawn in it. A sidecar that lists a collapsed menu doesn't push captions around.

**`scripts/burn-probe.mjs`** burns one frame and says why each callout landed where it did. It needs a workspace with the tokens file, so make a scratch one beside the captures:

```json
{
  "schema": "docsxai/workspace@1",
  "app_url": "http://localhost:3000/",
  "created_at": "2030-01-01T00:00:00.000Z",
  "burn": {
    "theme": {
      "from": "trackxai-dark.tokens.json",
      "tokens": { "scale": "render.scale", "display_width": "render.display-width" }
    }
  }
}
```

Save that as `.docsxai.json` next to a copy of `trackxai-dark.tokens.json`, then:

```sh
node scripts/burn-probe.mjs \
  --screenshot raw/board.en.dark.390.png \
  --annotations raw/board.en.dark.390.json \
  --workspace ./probe-workspace --side 1=bottom --out probe.png
```

On a crowded phone capture the output looks like this:

```text
screenshot 390x844, theme from ./probe-workspace, caption scale 1.12

#1 "Pick a ticket to open its detail"
  asked bottom (arrow_style) -> side bottom, hint kept
  callout 90.87,315.36 226.18x25.86, 1 line(s): "1. Pick a ticket to open its detail"
  stem 22 px, connector line #f1f0e4, badge 0,229.76 29.12x29.12
  overlap obstacles 2871 px2, others 0 px2, ratio 0.491 UNPLACEABLE
  obstacle hits: #5 badge 186.83 px2, #6 callout 1954.2 px2, #6 stem 15.36 px, #7 callout 275.94 px2
  sides at base size, lowest cost wins: bottom* cost 17109 overlap 1805 stem 20 | top cost 21229 overlap 1805 stem 20 | right no room | left no room
```

- `asked` is the side you hinted (`--side 1=bottom` sets `arrow_style` of the first annotation, `--strict-side` sets `placement.side`), `->` the side taken, and `hint kept` or `hint lost` says whether the hint won.
- `callout -` and `connector none` mean the annotation fell back to a badge.
- `obstacle hits` names each part (`callout`, `stem`, `badge`) that touches a listed box, and the box by its 1-based position in `obstacles`. Stems count in px along the box, the rest in px².
- `sides` shows each side's best cost at base size. `no room` means the callout doesn't fit that side.
- `connector` says how the line is painted: `line` and its colour here, or the triangle's ink, fill or outline.

`--json` prints the same data for a script. The probe lays the caption out a second time from the sidecar's boxes alone, without the pixel scan the burner adds. `callout`, `badge`, `side` and the overlap lines are from the real burn, and `sides`, `stem` and `connector` come from that second layout, so they can differ on a capture whose text the sidecar didn't list.

## 5. The strict no-overlap check

Strict means a caption or badge covers no listed text, no other annotation's target and no other caption or badge. `full` burns and the report's `unplaceable` count tolerate up to 10% of overlap, so a project that wants zero checks the geometry itself. This test reads the files `docsxai burn --report` writes and needs nothing but Node:

```js
// caption-overlap.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const workspace = process.env.WORKSPACE ?? ".";
const read = (...parts) => JSON.parse(readFileSync(join(workspace, ...parts), "utf8"));
const touches = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0;

test("no caption or badge covers text, a target, or another caption", () => {
  const problems = [];
  for (const { flow, annotations } of read("burn-report.json").flows) {
    const records = read("docs", flow, "annotations.json").annotations;
    const parts = annotations.flatMap((a, i) =>
      [
        a.callout && { name: `caption ${a.index ?? i + 1}`, box: a.callout, entry: a },
        a.badge && { name: `badge ${a.index ?? i + 1}`, box: a.badge, entry: a },
      ].filter(Boolean),
    );
    for (const part of parts) {
      const own = records.find(
        (r) => r.step === part.entry.step && r.selector === part.entry.selector,
      );
      const where = `${flow}/${part.entry.step}: ${part.name}`;
      for (const o of own?.obstacles ?? []) {
        if (touches(part.box, o)) problems.push(`${where} covers listed text at ${o.x},${o.y}`);
      }
      for (const other of records) {
        if (other === own || other.step !== part.entry.step || !other.bounding_box) continue;
        if (touches(part.box, other.bounding_box))
          problems.push(`${where} covers the target of ${other.selector}`);
      }
      for (const other of parts) {
        if (other !== part && other.name < part.name && touches(part.box, other.box)) {
          problems.push(`${where} overlaps ${other.name}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});
```

```sh
docsxai burn ./docs-workspace --report burn-report.json
WORKSPACE=./docs-workspace node --test caption-overlap.test.mjs
```

A failure lists each problem, such as `board/board: badge 1 covers listed text at 16,220`. Use `caption_style: "auto"` so the caption steps aside, or give a side hint ([Side hints](annotation-placement.md#side-hints)). A badge sits off its target's corner and can touch a listed box beside it, which fails the check under any `caption_style`. Probe that frame, and drop the box from `obstacles` if nothing is drawn there.

For the script's captures there's a shorter gate. It prints every `check:` line to stderr and exits 0, so fail on the lines:

```sh
node scripts/burn-trackxai.mjs --raw raw --out web/public/screens --theme dark 2> burn.err
! grep -q '^check:' burn.err
```

`packages/viewer/test/burn-real-sidecars.test.ts` is the same check in the repo's own suite: real sidecars, a synthetic screen with text stripes in every listed box, and assertions that no caption or badge covers text, a target or the phone chrome.

## 6. Worked example: a light and dark pair

`examples/burn-theme/` holds two tokens files for a light and a dark app:

| File                         | `accent`  | Callout fill | Text      | Badge fill |
| ---------------------------- | --------- | ------------ | --------- | ---------- |
| `trackxai-light.tokens.json` | `#5c00b8` | `#fafaf5`    | `#080f11` | `#5c00b8`  |
| `trackxai-dark.tokens.json`  | `#a64dff` | `#151b20`    | `#f1f0e4` | `#8000ff`  |

Both set the line connector, 15 px text, an 8 px callout radius and `render.display-width` to `{ "default": 1100, "narrow": 350, "narrow_below": 900 }` with `render.scale` at `auto`. The script maps the two `render` tokens for you, and a workspace maps them as in [section 2](#2-sizes-per-width-class).

Take a `raw/` folder with two screens, `board` and `ticket`, at 1280 and 390 in both schemes (8 PNGs and 8 sidecars), and run the whole thing:

```sh
node scripts/burn-trackxai.mjs --raw raw --out web/public/screens --theme light --rename ticket=ticket-detail
node scripts/burn-trackxai.mjs --raw raw --out web/public/screens --theme dark --rename ticket=ticket-detail
for f in web/public/screens/*/*.png; do
  cwebp -lossless -z 9 -quiet "$f" -o "${f%.png}.webp"
done
```

Each burn prints the paths it wrote, then the manifest's:

```text
web/public/screens/desktop-1280/board.a1bebc61.png
web/public/screens/mobile-390/board.fba4c7cb.png
web/public/screens/desktop-1280/ticket-detail.db51fbf0.png
web/public/screens/mobile-390/ticket-detail.71209ab0.png
web/public/screens/manifest.json
```

That's the dark run. The tree after both runs and the twins:

```text
web/public/screens/
  desktop-1280/
    board.77ddedea.png  board.77ddedea.webp
    board.a1bebc61.png  board.a1bebc61.webp
    ticket-detail.db51fbf0.png  ticket-detail.db51fbf0.webp
    ticket-detail.f6558ea0.png  ticket-detail.f6558ea0.webp
  mobile-390/
    board.0e7756eb.png  board.0e7756eb.webp
    board.fba4c7cb.png  board.fba4c7cb.webp
    ticket-detail.71209ab0.png  ticket-detail.71209ab0.webp
    ticket-detail.8b19b86a.png  ticket-detail.8b19b86a.webp
  manifest.json
```

Those names come from synthetic captures, so yours will differ. The same raws give the same names on every run. The manifest holds eight variants (`en.light.1280`, `en.dark.390` and so on) under `board` and `ticket-detail`.

A clean run prints no `check:` or `badge only:` line. When one appears, take the frame it names and probe it with `burn-probe.mjs` as in [section 4](#4-reading-the-burn-report). To see the pair next to the old triangle on synthetic screens, run `node scripts/burn-trackxai-sample.mjs`, which prints the PNG paths under `/tmp/burn-before-after`.
