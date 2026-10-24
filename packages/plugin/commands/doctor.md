---
description: "Health-check the docsxai environment and workspace (one ok: or fail: line per check, each with a next: step)."
argument-hint: "[<workspace-dir>]"
---

Arguments: `$ARGUMENTS`

Pass the value, when there is one, as a single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Run the doctor subcommand:

```
docsxai doctor ['<workspace-dir>']
```

It checks Node >= 26, Chromium presence (with the install command), the workspace config (fields and the `burn.theme` shape), write access to the workspace and its output dirs, flow-file parses, the auth descriptor and cached-session freshness, a short HEAD to `app_url` (skipped when this machine looks offline, or when the command gets the --offline flag), backend reachability and login state (when `backend_url` is set), the plugin declarations (same inspection as `plugins list`, no plugin code is executed), viewer-bin resolution (which of the three layers hit), and `DOCSX_*` env sanity. Exit 1 means at least one `fail:` line.

Report the checklist verbatim, then walk the `fail:` lines in order. Each carries its own `next:` step. Apply fixes only with the operator's confirmation (an expired session means `docsxai capture-auth '<workspace-dir>'`, which needs a human login). Run doctor again afterwards to confirm the table is green. The last line is `ok: doctor: ...` or `fail: doctor: ...`.
