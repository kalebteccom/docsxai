# @kalebtec/site-docs-engine

LLM-agnostic engine: flow-file parser + runtime, calibration helpers, target-site auth strategies, and the full `site-docs` CLI.

The engine **never** calls a model API. Calibration-time inference is supplied by the host agent (Claude Code, Codex, anything that speaks MCP) through the plugin's skill surface; execution is deterministic and replays a doc pack through headless Playwright.

## Surface

- **Flow-file** — declarative YAML at `<workspace>/flows/<name>.flow.yaml`: `prerequisites` + `locators` + `steps[]` (`action`, `target`, `wait_for`, `success`, `annotation` / `annotations`). Hand-editable; schema-validated. `extends:` composition for shared preambles.
- **`BrowserDriver`** interface — what the runtime needs from a browser. The `PlaywrightDriver` implementation includes the `actionable()` predicate (see [`docs/actionability-contract.md`](../../docs/actionability-contract.md)) that browser-bridge consumers can mirror.
- **Auth strategies** — `auth/strategy.yaml` descriptor + the `manual-capture` strategy (security-lowered instrumented Chrome → human logs in → `storageState` cached locally with the real auth-cookie's expiry tracked). Other strategies (API-direct, JWT-injection, etc.) are interface-accommodated.
- **CLI** — `site-docs <command>`. See `--help` or the [top-level README](../../README.md) for the full surface; this package's `dist/cli.js` is the binary.

## CLI commands

```
init           scaffold a workspace
capture-auth   cache an authed session
calibrate      extract a flow-file from a structured guide
inspect        discover [data-testid] locators on the live page
run            execute flows headless; emit annotations + screenshots
render         build the static viewer (shells out to @kalebtec/site-docs-viewer)
lint           static checks across flow-files (R001-R004)
flow-tree      visualise the `extends` graph
diagnose       halt-context + recommendations after a halt
style          init/validate style.yaml; --check scans for jargon leaks
zip            package the doc pack for hand-off
```

`run` has a sub-3-second iteration mode for long-async flows: `--start-from <step-id> --cdp <endpoint>` skips every step before the target and attaches to an already-warm Chrome.

## License

[Apache-2.0](../../LICENSE).
