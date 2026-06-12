---
description: List, inspect, or sync the workspace's docsxai plugins (publishers, renderers, lint-rules, auth-strategies).
argument-hint: <list|info|sync> <workspace-dir> [<namespace>]
---

Run the plugins subcommand:

```
docsxai plugins $ARGUMENTS
```

`list` prints the status table (loaded / disabled reasons — capability mismatch, cycle, dep missing, lock mismatch) and exits 1 if any plugin isn't `loaded`. `info <namespace>` prints the manifest + registered artifact names. `sync` (re)writes `plugins-lock.json` (sha256 pins, verified before any plugin code runs — it never executes plugins). Plugins are declared in `.docsxai.json` under `plugins` (package or path sources) with `plugin_capabilities` granting e.g. `egress:*.atlassian.net`. Report the table verbatim; on a lock mismatch suggest `sync` only after the operator confirms the plugin change was intentional.
