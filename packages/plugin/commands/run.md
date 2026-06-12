---
description: Deterministically re-run a project's flow-files and refresh its docs (no LLM involvement).
argument-hint: <project-dir> [--flow <name>] [--base-url <url>]
---

Run the deterministic execution CLI:

```
docsxai run $ARGUMENTS
```

This loads `<project-dir>/flows/<flow>.flow.yaml` plus the cached session in `<project-dir>/.auth/`,
launches headless Chromium, replays each flow, and re-emits `docs/<flow>/annotations.json` + screenshots.
Report which flows ran, how many steps/annotations each produced, and any failures verbatim. If it reports
no Chromium binary, tell the user to run `npx playwright install chromium`. If it reports an expired/missing
session, tell the user to re-capture (the calibration auth step). Do **not** retry on a flow-execution
failure — a halted flow is a drift signal; offer to run `/docsxai:diagnose` instead.
