---
description: Export the doc pack as a wiki-ready Confluence ADF projection, or as Playwright specs.
argument-hint: <adf|playwright> <workspace-dir> [--flow <name>] [--mode single|page-tree] [--title <text>] [--out <dir>]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Export the projection:

```
docsxai export <adf|playwright> '<workspace-dir>' [flags]
```

`--mode` and `--title` apply to `adf` only.

`export adf` writes `<workspace-dir>/.export/adf/projection.json` and `attachments.json`: a pure, deterministic Confluence ADF projection (one consolidated page by default, `--mode page-tree` for a parent plus one child per flow). Burned screenshots (`docsxai burn '<workspace-dir>'`) are referenced when present and clean screenshots otherwise; the projection's `warnings` say which. Hand the projection to the Atlassian MCP for the human-in-the-loop path. The Confluence publisher plugin (`confluence:push`) pushes it idempotently, but it is repo-only today: it isn't on npm, so it needs a checkout and a `path` source in `.docsxai.json`.

`export playwright` writes one self-contained `.spec.ts` per flow into `<workspace-dir>/.export/tests/` (or `--out`). The files carry a header saying they are generated: regenerate, don't hand-edit.

Report the output paths, the document or spec count, and any warnings. A failure prints a `next:` line.
