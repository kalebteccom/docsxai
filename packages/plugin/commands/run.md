---
description: Re-run a workspace's flows headlessly and refresh its screenshots and annotations (deterministic, no LLM).
argument-hint: <workspace-dir> [--flow <name>] [--variant <id>] [--base-url <url>] [--verify-determinism]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Run the deterministic execution CLI:

```
docsxai run '<workspace-dir>' [flags]
```

This loads `<workspace-dir>/flows/<flow>.flow.yaml` plus the cached session in `<workspace-dir>/.auth/`, launches headless Chromium, replays each flow, and re-emits `docs/<flow>/annotations.json` and the screenshots. A flow with a top-level `matrix:` runs once per variant and writes under `docs/<flow>/<variant>/`; `--variant <id>` runs one of them. `--verify-determinism` runs the selected flows 2 to 5 times (`--runs`) and byte-compares every artefact: the workspace output is written only when all runs agree, and the report names the first differing artefact (exit 0 identical, 1 differing or halted).

The last line is `run: <n> of <m> flows ok, outputs in <dir>`. Report it, the flows that ran, and any failure verbatim, including the `next:` line under each failed flow.

- No Chromium binary: tell the user to run `npx playwright-core install chromium` (source checkout: `pnpm -C packages/engine exec playwright-core install chromium`), then run again.
- Missing or expired session: tell the user to run `docsxai capture-auth '<workspace-dir>'`. It opens a headed browser and needs a human login, so don't start it unattended.
- A flow halted: that is a drift signal. Don't retry. Run the `docsxai diagnose` command from its `next:` line, or load the `diagnose` skill (`/docsxai:diagnose`).
- Exit 2 is a usage error. The message shows the usage line to fix.
