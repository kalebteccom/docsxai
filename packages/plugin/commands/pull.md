---
description: Pull a revision's artifacts from the backend into the workspace files.
argument-hint: <workspace-dir> [--rev <id>]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Pull a revision (default: `head`):

```
docsxai pull '<workspace-dir>' [flags]
```

It fetches each artifact slot on the named revision and writes it back into the workspace files (`flows/`, `docs/<flow>/annotations.json`, `docs/<flow>/screenshots/`, `docs/style.{yaml,json}`, `docs/locators.yaml`). The last line is `pull: revision <rev_id> … wrote <n> file(s)`. Use it to sync with another operator's edits or to roll back to a named revision.

The workspace must be bound to a backend (`backend_url`, `backend_workspace_id` and `backend_project_id` in `.docsxai.json`), which the first `push` sets up. Otherwise it exits 2 and the `next:` line says how to bind it.

**Warning:** `pull` overwrites local files in the artifact paths it touches. Commit or push in-progress changes before pulling someone else's revision. A revision that names a file a workspace would not produce is refused with nothing written; the `next:` line suggests an older `--rev`.
