---
description: Pull a revision's artifacts from the backend into the workspace files.
argument-hint: <workspace-dir> [--rev <id>]
---

Pull a revision (default: `head`):

```
docsxai pull $ARGUMENTS
```

Fetches each artifact slot present on the named revision and writes it back into the workspace files (`flows/`, `docs/<flow>/annotations.json`, `docs/<flow>/screenshots/`, `docs/style.{yaml,json}`, `docs/locators.yaml`). Useful for syncing with another operator's edits, or for rolling back to a named revision.

Requires the workspace to be bound to a backend (`backend_url` + `backend_workspace_id` + `backend_project_id` in `.docsxai.json`) — typically established on the first `push`.

**Warning:** `pull` overwrites local files in the artifact paths it touches. Commit any in-progress changes (e.g. via `push` first) before pulling someone else's revision.
