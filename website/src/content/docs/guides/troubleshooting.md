---
title: Troubleshooting
description: What to do when a step halts - reading the halt cause, site-docs diagnose, lint, and the fast iteration loop.
---

When a step can't complete, the run halts with a `[cause: ...]` prefix
inferred from Playwright's actionability log (for example `[target is
disabled]` or `[selector matched multiple elements]`), plus a halt screenshot
under `docs/<flow>/halts/`. Read the cause first; the screenshot is for
confirming.

`site-docs diagnose` packages the halted step's selector, waits, halt
screenshot, and (with `--cdp`) a live actionability probe into typed
recommendations. `site-docs lint` catches most authoring mistakes before a run
ever happens. The fast inner loop for fixing a step lives in the
[agent runbook](/guides/agent-runbook/).
