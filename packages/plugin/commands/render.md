---
description: Build the interactive docs viewer for a workspace from its doc pack.
argument-hint: <workspace-dir>
---

Arguments: `$ARGUMENTS`

Pass the value as one single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Build the static viewer:

```
docsxai render '<workspace-dir>'
```

It reads `<workspace-dir>/docs`, writes `<workspace-dir>/.viewer`, and ends with `render: open <workspace-dir>/.viewer/index.html`. Report that path.

- `docs/` missing: the viewer comes out empty. Run `docsxai run '<workspace-dir>'` first.
- The viewer bin isn't found: run `docsxai doctor '<workspace-dir>'`. It shows which of the three lookups hit (`DOCSX_VIEWER_BIN`, the `@docsxai/viewer` package next to the engine, `docsxai-viewer` on PATH).

For delivery without the interactive viewer, the CLI has `docsxai burn` (annotations baked into PNG copies) and `docsxai pack` (the screenshot pack a docs site ships). Neither has a slash command; see `docsxai --help`.
