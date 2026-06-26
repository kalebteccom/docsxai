<p align="center">
  <img src="brand/docsxai-favicon.svg" width="96" height="96" alt="docsxai">
</p>

# docsxai

> **Turn a real web app into step-by-step, screenshot-rich user guides that stay current automatically.**

docsxai walks your web application, follows flows you describe in plain files, and emits documentation with clean, annotated screenshots — halos, numbered badges, callouts, captions. You teach it a flow **once**; after that it replays the same flow headlessly, on demand, producing the same docs every time. The core engine never calls a model API, so regenerating your docs on every commit is cheap and reproducible instead of expensive and flaky.

**Who it's for.** Product, platform, and docs engineers who maintain end-user documentation for a web app — especially an authenticated SPA whose UI changes often enough that hand-maintained screenshots go stale. Two roles share the workflow:

- a **calibration author** (often working through an AI coding agent like Claude Code or Codex over MCP) who teaches docsxai a user flow once;
- a **CI / automation owner** who then re-runs `docsxai run` on every commit to regenerate the docs deterministically — no LLM calls, no agent in the loop.

**What you can do with it:**

- Keep an authenticated SaaS app's user guide in sync — calibrate the key flows once, regenerate annotated screenshots on every release so the docs never show stale UI.
- Catch documentation drift in CI — `docsxai baseline` + `docsxai diff --fail-on warn` flags a PR whose UI change breaks a documented flow, before it merges.
- Publish a polished docs site — emit an Astro Starlight site or a single-file interactive viewer with per-step screenshots, callouts, and captions.
- Push the same docs into an existing knowledge base — idempotent Confluence Cloud publishing, so re-running an unchanged flow makes zero edits and only real changes land.
- Document flows that need login and clean data — capture an authed session (interactive manual capture or one of ten scripted strategies, eleven in all) and apply deterministic redactions so secrets and PII never reach a screenshot.

## How it works: two modes

The thing that makes docsxai's cost story honest is a clean split between an expensive step you run rarely and a cheap step you run constantly.

- **Calibration — AI-assisted, rare.** A host agent (Claude Code, Codex, or anything that speaks MCP) drives the discovery → mapping + testing → commit pipeline through the engine's CLI and a browser bridge ([browxai](https://github.com/kalebteccom/browxai) is the canonical model-agnostic driver). The output is a self-sufficient **doc pack**: flow files, `annotations.json`, `style.yaml`, per-step markdown, screenshots, a locator manifest, and an auth-strategy descriptor. You pay for an agent here, once.
- **Execution — deterministic, continuous.** `docsxai run` replays the doc pack through headless Playwright. No agent, no MCP, no model calls. Same input → same output. This is what runs in CI on every commit.

Per-commit LLM runs would be untenable; per-commit Playwright runs are standard. That's the whole bet.

## Install (Node 20+)

```bash
pnpm add -g docsxai      # batteries-included: the docsxai CLI + the viewer
```

The granular equivalent is `pnpm add -g @docsxai/engine @docsxai/viewer`.

### From source

```bash
corepack enable          # provides pnpm
pnpm install
pnpm -C packages/engine exec playwright-core install chromium
pnpm -r build
```

The `docsxai` CLI binary lands at `packages/engine/dist/cli.js`. Two convenient ways to put it on your `PATH`:

```bash
# Option A — wrapper script (sidesteps pnpm-global-store quirks):
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$(pwd)" > "$HOME/.local/bin/docsxai"
chmod +x "$HOME/.local/bin/docsxai"
export PATH="$HOME/.local/bin:$PATH"

# Option B — pnpm global link (when the store is consistent):
pnpm -C packages/engine link --global
```

## Quick start

```bash
# 1. Scaffold a workspace (keep it OUTSIDE the app's source repo — docsxai documents
#    a running app from outside and never writes into the app repo)
docsxai init ~/docsxai/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h

# 2. Capture an authed session (an instrumented Chrome opens; log in; the session is cached locally)
docsxai capture-auth ~/docsxai/my-app

# 3. Calibrate a flow — either from a structured guide…
docsxai calibrate ~/docsxai/my-app --from path/to/flow-guide.md
#    …or hand-author `flows/<name>.flow.yaml` after exploring the live page (see docs/agent-runbook.md)

# 4. Run it (deterministic; no agent context, no LLM calls)
docsxai run ~/docsxai/my-app

# 5. Render the interactive viewer
#    (from a source checkout, point the engine at the built viewer bin;
#     an installed @docsxai/viewer is found automatically)
DOCSX_VIEWER_BIN="$PWD/packages/viewer/dist/index.js" docsxai render ~/docsxai/my-app
open ~/docsxai/my-app/.viewer/index.html

# 6. Package the doc pack into a zip for hand-off
docsxai zip ~/docsxai/my-app --out my-app-docs.zip
```

> `docsxai run` launches Chromium. If no browser binary is present, install one with
> `npx playwright-core install chromium` (or, from a source checkout,
> `pnpm -C packages/engine exec playwright-core install chromium`).

For the full agent-driven workflow and the fast calibration loop (`lint`, `flow-tree`, `diagnose`, `style --check`, and `run --start-from --cdp` for the sub-3-second iteration loop), see [**docs/agent-runbook.md**](docs/agent-runbook.md).

## CLI reference

```
docsxai init <workspace>           # scaffold a workspace
docsxai capture-auth <workspace>   # cache an authed session (manual-capture strategy)
docsxai calibrate <workspace>      # extract a flow file from a structured guide
docsxai inspect <workspace>        # discover [data-testid] locators on the live (authed) page
docsxai run <workspace>            # execute flows headless; emit annotations + screenshots
docsxai render <workspace>         # build the static / interactive viewer
docsxai lint <workspace>           # static checks across flow files
docsxai flow-tree <workspace>      # visualise the `extends` graph
docsxai diagnose <workspace>       # halt-context + recommendations after a halt
docsxai doctor [<workspace>]       # environment + workspace health check (one-line fix per ✗)
docsxai style <workspace>          # init/validate style.yaml; --check scans for jargon leaks
docsxai zip <workspace>            # package the doc pack for hand-off (deterministic, in-process)
docsxai baseline <workspace>       # snapshot the doc pack for drift comparison
docsxai diff <workspace>           # deterministic drift report (--fail-on warn|fail as a CI gate)
docsxai export adf|playwright      # Confluence ADF projection / Playwright spec export
docsxai plugins <list|info|sync>   # workspace plugin runtime: status, manifests, sha256 lock
docsxai login / push / pull        # backend persistence (OAuth 2.1 PKCE or CI bearer)
```

`docsxai --help` shows every command, flag, and the inline `Notes:` block with per-command detail.

## Packages

| package                                                     | role                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@docsxai/engine`](packages/engine/)                       | The LLM-agnostic engine: flow-file parser + deterministic runtime (environment controls, redaction), the plugin runtime, the 11-strategy auth catalogue, pure exporters (ADF), and the full `docsxai` CLI. |
| [`@docsxai/plugin`](packages/plugin/)                       | Claude Code plugin — calibrate + diagnose skills; run/render/login/push/pull/plugins/export commands. The recommended surface for agent-driven workflows.                                                  |
| [`@docsxai/viewer`](packages/viewer/)                       | Rendering surface: interactive single-file viewer, browser-free `burn` renderer (baked annotations), and the Astro Starlight docs-site emitter.                                                            |
| [`@docsxai/backend`](packages/backend/)                     | Doc-pack persistence service: FS or in-memory store, content-addressed blobs, finalized linear-immutable revisions, OAuth 2.1 + PKCE, encrypted auth-cache relay, GitHub App webhook surface.              |
| [`@docsxai/skill`](packages/skill/)                         | Optional vendorable `.claude/skills/` fallback; delegates to the installed plugin. For teams that prefer version-pinning in the consumer repo.                                                             |
| [`@docsxai/mcp`](packages/mcp/)                             | Standalone stdio MCP server: calibration meta-orchestration + doc-pack introspection for any MCP host (no browser primitives — browxai owns discovery).                                                    |
| [`@docsxai/plugin-confluence`](packages/plugin-confluence/) | First-party publisher plugin — idempotent Confluence Cloud REST v2 push (`confluence:push`), capability-gated egress.                                                                                      |
| [`@docsxai/plugin-starlight`](packages/plugin-starlight/)   | First-party renderer plugin — Starlight site emission (`starlight:site`).                                                                                                                                  |

## Documentation

- [**docs/agent-runbook.md**](docs/agent-runbook.md) — hand-it-to-an-agent workflow runbook
- [**docs/running-against-an-app-repo.md**](docs/running-against-an-app-repo.md) — human-readable runbook
- [**docs/ci-recipes.md**](docs/ci-recipes.md) — wiring `run` / `baseline` / `diff` into CI
- [**docs/actionability-contract.md**](docs/actionability-contract.md) — the portable `actionable()` predicate contract, for browser-bridge consumers
- [**docs/browxai-asks.md**](docs/browxai-asks.md) — integration contract with the discovery driver
- [`CHANGELOG.md`](CHANGELOG.md) — release notes · [`RELEASING.md`](RELEASING.md) — release process

## Contributing

See [**CONTRIBUTING.md**](CONTRIBUTING.md).

## License

Code is [Apache-2.0](LICENSE).

The **docsxai name and logo are trademarks of Kalebtec** and are not
covered by the Apache License (Apache-2.0 §6 withholds trademark
rights). The brand assets under [`brand/`](brand/) are
all-rights-reserved (see [`brand/LICENSE`](brand/LICENSE)). See
[TRADEMARKS.md](TRADEMARKS.md) for the full brand policy.
