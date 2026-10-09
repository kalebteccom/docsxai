---
description: List, inspect, or sync the workspace's docsxai plugins (publishers, renderers, lint-rules, auth-strategies).
argument-hint: <list|info|sync> <workspace-dir> [<namespace>]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Run the plugins subcommand:

```
docsxai plugins <list|info|sync> '<workspace-dir>' ['<namespace>']
```

`list` prints the status table (loaded, or the disabled reason: capability mismatch, cycle, dependency missing, lock mismatch) and exits 1 if any plugin isn't `loaded`. `info '<workspace-dir>' '<namespace>'` prints the manifest and the registered artifact names. `sync` (re)writes `plugins-lock.json` (sha256 pins, verified before any plugin code runs; it never executes plugins). `--format json` gives the machine-readable form.

Plugins are declared in `.docsxai.json` under `plugins` (`{ "package": … }` or `{ "path": … }` sources), with `plugin_capabilities` granting e.g. `egress:*.atlassian.net`. The first-party publisher and renderer plugins live in the docsxai repository and aren't on npm, so they are declared with a `path` source from a checkout. Report the table verbatim. On a lock mismatch suggest `sync` only after the operator confirms the plugin change was intentional.
