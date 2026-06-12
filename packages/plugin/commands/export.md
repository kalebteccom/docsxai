---
description: Export the doc pack as a wiki-ready projection (Confluence ADF today).
argument-hint: adf <workspace-dir> [--flow <name>] [--mode single|page-tree] [--out <dir>]
---

Export the projection:

```
site-docs export $ARGUMENTS
```

`export adf` writes `<workspace>/.export/adf/projection.json` + `attachments.json` — a pure, deterministic Confluence ADF projection (one consolidated page by default; `--mode page-tree` for parent + per-flow children). Burned screenshots (`docsxai-viewer burn <workspace>`) are referenced when present; clean screenshots otherwise (the projection's `warnings` say which). Hand the projection to the Atlassian MCP for the human-in-the-loop agentic path, or configure `@kalebtec/docsxai-plugin-confluence` (`confluence:push`) for direct idempotent push. Report the output paths, document count, and any warnings.
