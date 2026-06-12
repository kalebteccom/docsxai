---
description: Health-check the docsxai environment + workspace (✓/✗ checklist with a one-line fix per failure).
argument-hint: [<workspace-dir>]
---

Run the doctor subcommand:

```
docsxai doctor $ARGUMENTS
```

It checks Node >= 20, Chromium presence, the workspace config, flow-file parses, the auth descriptor + cached-session freshness, backend reachability (when `backend_url` is set), the plugin declarations (same inspection as `plugins list` — no plugin code is executed), viewer-bin resolution (which of the three layers hit), and `DOCSX_*` env sanity. `−` rows are informational; exit 1 means at least one `✗`.

Report the checklist verbatim, then walk the `✗` rows in order — each carries its own one-line fix. Apply fixes only with the operator's confirmation (e.g. an expired session means re-running `docsxai capture-auth`, which needs a human login). Run doctor again after fixing to confirm the table is green.
