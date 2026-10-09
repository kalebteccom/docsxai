---
description: Health-check the docsxai environment and workspace (✓/✗ checklist with a one-line fix per failure).
argument-hint: [<workspace-dir>]
---

Arguments: `$ARGUMENTS`

Pass the value, when there is one, as a single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Run the doctor subcommand:

```
docsxai doctor ['<workspace-dir>']
```

It checks Node >= 26, Chromium presence, the workspace config, flow-file parses, the auth descriptor and cached-session freshness, backend reachability (when `backend_url` is set), the plugin declarations (same inspection as `plugins list`, no plugin code is executed), viewer-bin resolution (which of the three layers hit), and `DOCSX_*` env sanity. `−` rows are informational. Exit 1 means at least one `✗`.

Report the checklist verbatim, then walk the `✗` rows in order. Each carries its own one-line fix. Apply fixes only with the operator's confirmation (an expired session means `docsxai capture-auth '<workspace-dir>'`, which needs a human login). Run doctor again afterwards to confirm the table is green. The last line is `doctor: <result>`.
