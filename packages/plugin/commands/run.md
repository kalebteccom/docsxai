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

`--device-scale-factor <1-4>` captures at that many device pixels per CSS pixel (default 1); `annotations.json` records it and `docsxai burn` reads it. Not with `--cdp`.

Each flow prints `run: <flow>, starting` before its browser launches (`run [<flow>]: …` with `--concurrency` above 1), so a long log shows which flow is in flight. A clean run's last line, on stdout, is `run: <n> of <m> flows ok, outputs in <dir>`. The noun is `flow variants` when a flow has a `matrix:` and `flow` when `m` is 1. A halt prints `run: <n> of <m> flows failed, <k> ok; outputs in <dir>` on stderr, then one indented `<flow>: next: <command>` line per failed flow, and exits 1. Report the summary, the flows that ran, and any failure verbatim, including each failed flow's `next:` line.

- No Chromium binary: tell the user to run `npx playwright-core install chromium` (source checkout: `pnpm -C packages/engine exec playwright-core install chromium`), then run again.
- Missing or expired session: tell the user to run `docsxai capture-auth '<workspace-dir>'`. It opens a headed browser and needs a human login, so don't start it unattended.
- A flow halted: that is a drift signal. Don't retry. Run the `docsxai diagnose` command from its `next:` line, or load the `diagnose` skill (`/docsxai:diagnose`).
- Exit 2 is a usage error. The message shows the usage line to fix.
- `docsxai: interrupted` means Ctrl-C or SIGTERM (exit 130 or 143). The line names the command to rerun, which starts over.
- Anything else that fails to start: run `docsxai doctor '<workspace-dir>'` and follow each `fail:` line's `next:` step.
- Burned captions (`docsxai burn`, `docsxai pack`) look small on the page: see "Burned captions" in `/docsxai:calibrate`.
