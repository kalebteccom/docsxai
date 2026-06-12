---
description: Push the workspace's doc pack to the configured backend as a new revision.
argument-hint: <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
---

Push the doc pack:

```
docsxai push $ARGUMENTS
```

Reads `flows/` + `docs/` from the workspace, serialises each artifact slot (flows / annotations / screenshots / style / locators), and POSTs them as a new revision against the backend named in `.docsxai.json`'s `backend_url`. On first push, creates the backend workspace + project and persists the new IDs back into `.docsxai.json`. Reports the new `rev_id`. The `DOCSX_TOKEN` env var must be set; run `/docsxai:login` first if you're not sure.

Common failure modes:

- `push: no backend_url in .docsxai.json` — set it (e.g. `http://localhost:4477` for a local stub) or hand-edit the workspace config.
- `push: no bearer token` — export `DOCSX_TOKEN`.
- A 4xx from the backend usually means workspace / project ID drift (re-bind by clearing `backend_workspace_id` + `backend_project_id` from `.docsxai.json`).
