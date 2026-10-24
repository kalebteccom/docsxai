---
description: Build the interactive docs viewer for a workspace from its doc pack.
argument-hint: <workspace-dir>
---

Arguments: `$ARGUMENTS`

Pass the value as one single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Build the static viewer:

```
docsxai render '<workspace-dir>'
```

It reads `<workspace-dir>/docs`, writes `<workspace-dir>/.viewer`, and prints a last line that starts `render: open <workspace-dir>/.viewer/index.html`. Report that path.

- `docs/` missing: the viewer comes out empty. Run `docsxai run '<workspace-dir>'` first.
- Page text is English by default and `render` has no language flag. For Spanish labels and notices, run the viewer bin yourself: `docsxai-viewer build '<workspace-dir>/docs' '<workspace-dir>/.viewer' --lang es`. A matrix variant flow uses the locale in its variant id.
- The viewer bin isn't found: run `docsxai doctor '<workspace-dir>'`. Its `viewer` line shows where the viewer was found, or how to install it.

For delivery without the interactive viewer, the CLI has `docsxai burn` (annotations baked into PNG copies) and `docsxai pack` (the screenshot pack a docs site ships). Neither has a slash command; see `docsxai --help`.
