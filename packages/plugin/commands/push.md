---
description: Push the workspace's doc pack to the configured backend as a new revision.
argument-hint: <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Push the doc pack:

```
docsxai push '<workspace-dir>' [flags]
```

It reads `flows/` and `docs/` from the workspace, serialises each artifact slot (flows, annotations, screenshots, style, locators), and posts them as a new revision against the backend named by `backend_url` in `.docsxai.json`. On the first push it creates the backend workspace and project and writes the new IDs back into `.docsxai.json`. The last line is `push: revision <rev_id> …`; report the `rev_id`. `--kind` defaults to `calibrate`. A token must be available: `DOCSX_TOKEN`, or the OAuth tokens that `docsxai login --backend-url '<url>' --oauth '<workspace-dir>'` stored. If unsure, run `/docsxai:login` first.

Every failure names the command to run next. The common ones:

- `no backend_url in .docsxai.json` (exit 2): add `"backend_url"` to the config (for example `http://localhost:4477` for a local backend), then log in.
- `no bearer token`, or a 401 or 403: set `DOCSX_TOKEN` or run `docsxai login --backend-url '<url>' --oauth '<workspace-dir>'`.
- `cannot reach <url>`: check `backend_url` and that the backend is running.
- A 404 means `backend_workspace_id` or `backend_project_id` drifted. Remove both from `.docsxai.json` and push again to bind a new pair.
