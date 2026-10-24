// The `docsxai-viewer` help text: usage lines for every command, then each command's flag notes.
// Kept out of index.ts so that file stays under the max-lines ceiling.

import { DEFAULT_UNPLACEABLE_RATIO } from "./burn-report.js";
import { PACK_DETAILS, PACK_SYNOPSIS } from "./pack-cli.js";

export const USAGE = `docsxai-viewer: static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]... [--lang <locale>]
  docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>] [--report <file>] [--max-overlap <ratio>] [--no-connector-outline] [--strict-glyphs]
  docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--lang <locale>] [--flow <name>]...
${PACK_SYNOPSIS}

  build: emit the interactive HTML viewer
    <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md;
                a flow that ran a matrix holds the same under <flow>/<variant>/, each variant a flow here)
    <out-dir>   where the generated viewer is written
    --flow      restrict to these flows (default: all flows with annotations.json); a flow that ran a
                matrix also selects its <flow>/<variant> pages
    --lang      locale of the text the pages add, e.g. es or es-ES (default: en; other tags give en);
                a matrix variant flow (<flow>/<locale>.<scheme>.<viewport>) uses its own locale

  burn: bake annotations into the PNGs (for surfaces that can't run the viewer)
    <workspace>  a docsxai workspace (reads <workspace>/docs; the burn.theme block of
                 <workspace>/.docsxai.json sets the look, see docs/burn-theming.md)
    --flow       restrict to these flows (default: all flows with annotations.json); a flow that ran a
                 matrix also selects its <flow>/<variant> outputs
    --out        output root (default: docs/<flow>/burned/<step>.png)
    --report     write a JSON placement report (callout and badge boxes, overlaps, unplaceable
                 flags) to <file>, resolved under <workspace> when relative; every callout is drawn
                 either way
    --max-overlap  share of its own area a callout may cover before the report flags it
                 unplaceable (default ${DEFAULT_UNPLACEABLE_RATIO})
    --no-connector-outline  skip reading the screenshot's pixels: an arrow or stem stays plain ink
                 (by default one over a dark part gets a white outline), a themed line keeps the
                 callout's outline colour, and no text is estimated from the pixels
    --strict-glyphs  exit 1 when a caption has characters the font can't draw (they burn as empty
                 boxes); without it they are a warning and \`missing_glyphs\` in the report

  site: emit a production Astro Starlight docs site (burned images preferred)
    <workspace>  a docsxai workspace (reads <workspace>/docs + <workspace>/flows)
    --out        site project directory (default: <workspace>/site)
    --build      also run astro build (writes <out>/dist)
    --title      site title (default: "Documentation")
    --accent     accent hex color (overrides the style artifact's visual keys)
    --lang       locale of the site, e.g. es or es-ES (default: en; other tags give en); sets
                 Starlight's language and the text of the copy and retry components
    --flow       restrict to these flows (default: all flows with annotations.json)

${PACK_DETAILS}`;
