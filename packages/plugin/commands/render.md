---
description: Build the interactive docs viewer for a workspace from its doc pack.
argument-hint: <workspace-dir> [--lang <locale>] [--open]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Build the static viewer:

```
docsxai render '<workspace-dir>' [--lang '<locale>'] [--open]
```

It reads `<workspace-dir>/docs`, writes `<workspace-dir>/.viewer`, and prints a last line that starts `render: open <workspace-dir>/.viewer/index.html`. Report that path. When the user asks to open the viewer, add `--open`: it opens that page in their default browser, or says it couldn't.

- `docs/` missing: the viewer comes out empty. Run `docsxai run '<workspace-dir>'` first.
- Page text is English by default. `--lang es` gives Spanish labels and notices. A matrix variant flow uses the locale in its variant id.
- The viewer bin isn't found: run `docsxai doctor '<workspace-dir>'`. Its `viewer` line shows where the viewer was found, or how to install it.

For delivery without the interactive viewer, the CLI has `docsxai burn` (annotations baked into PNG copies), `docsxai pack` (the screenshot pack a docs site ships) and `docsxai site` (an Astro Starlight docs site). None has a slash command; see `docsxai --help`.
