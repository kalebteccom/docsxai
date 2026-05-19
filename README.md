# Automated Site Documentation Bot

> **OSS engine + Claude Code plugin that walks a web application, follows written flows, and emits screenshot-rich user documentation.** LLM-agnostic engine — the host agent supplies inference, the engine never calls a model API.

The keystone bet: write a flow once (by hand, or via an agent-driven calibration cycle); replay it any time after that with **zero agent involvement and zero LLM calls** to produce fresh, deterministic docs. Calibration is rare and human-supervised; execution is cheap and CI-friendly.

## Status

Phase 0 (prototype & validation) closed **2026-05-15** — architectural bet proven on a real authed heavy-SPA target. Phase 1 (MVP) closed **2026-05-19** — engine-complete: deterministic agent-free replay, the full calibration-aid surface (lint / diagnose / flow-tree / `optional:true` / zip / style), browxai integration, ~193 tests. The public OSS release is **prepared but deferred to ≥ Phase 3 by owner decision** — this repo stays private/unpublished until the project is further along; see [`RELEASE.md`](RELEASE.md). Phase 2 (GitHub App, engine-side Confluence push, standalone MCP server) is the next planning cycle.

## Two-mode architecture

- **Calibration** (AI-assisted, rare). The host agent — Claude Code, Codex, or anything that speaks MCP — drives the discovery → mapping+testing → commit pipeline through the engine's CLI + a browser bridge ([browxai](https://github.com/kalebteccom/browxai) is the canonical model-agnostic driver). Output: a self-sufficient **doc pack** (flow-files + `annotations.json` + `style.yaml` + per-step markdown + screenshots + locator manifest + auth-strategy descriptor).
- **Execution** (deterministic, continuous). `site-docs run` replays the doc pack through headless Playwright. No agent, no MCP, no model calls. CI-friendly. Same input → same output.

The split is what makes the cost story honest: per-commit LLM runs would be untenable; per-commit Playwright runs are standard.

## Install (Node 20+)

```bash
corepack enable          # provides pnpm
pnpm install
pnpm -C packages/engine exec playwright-core install chromium
pnpm -r build
```

The `site-docs` CLI binary lands at `packages/engine/dist/cli.js`. Two convenient ways to put it on `PATH`:

```bash
# Option A — wrapper scripts (sidesteps pnpm-global-store quirks):
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$(pwd)" > "$HOME/.local/bin/site-docs"
chmod +x "$HOME/.local/bin/site-docs"
export PATH="$HOME/.local/bin:$PATH"

# Option B — pnpm global link (when the store is consistent):
pnpm -C packages/engine link --global
```

## Quick start

```bash
# 1. Scaffold a workspace (outside the app's source repo)
site-docs init ~/site-docs/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h

# 2. Capture an authed session (instrumented Chrome opens; log in; the cookie's cached locally)
site-docs capture-auth ~/site-docs/my-app

# 3. Calibrate a flow — either from a structured guide:
site-docs calibrate ~/site-docs/my-app --from path/to/flow-guide.md
#    …or by hand-authoring `flows/<name>.flow.yaml` after exploring the live page (see docs/agent-runbook.md)

# 4. Run it (deterministic; no agent context, no LLM calls)
site-docs run ~/site-docs/my-app

# 5. Render the interactive viewer
site-docs render ~/site-docs/my-app
open ~/site-docs/my-app/.viewer/index.html

# 6. (When ready to hand off) package the doc pack into a zip
site-docs zip ~/site-docs/my-app --out my-app-docs.zip
```

Full agent-driven workflow + the calibration-loop affordances (`lint`, `flow-tree`, `diagnose`, `style --check`, `run --start-from --cdp` for the sub-3-second iteration loop): see [**docs/agent-runbook.md**](docs/agent-runbook.md).

## Packages

| package | role |
|---|---|
| [`@kalebtec/site-docs-engine`](packages/engine/) | LLM-agnostic engine: flow-file parser + runtime, calibration helpers, target-site auth strategies, the full `site-docs` CLI. |
| [`@kalebtec/site-docs-plugin`](packages/plugin/) | Claude Code plugin — calibrate + diagnose skills, run/render/login commands. The recommended invocation surface for agent-driven workflows. |
| [`@kalebtec/site-docs-backend`](packages/backend/) | Authenticated stub service for doc-pack persistence (in-memory linear-immutable revisions today; hosted deployment is Phase 2). REST + per-resource endpoints. |
| [`@kalebtec/site-docs-skill`](packages/skill/) | Optional vendorable `.claude/skills/` fallback; delegates to the installed plugin. For teams that prefer version-pinning in the consumer repo. |
| [`@kalebtec/site-docs-viewer`](packages/viewer/) | Static-HTML viewer with halo + numbered badges + Popper-placed callouts overlaid on clean screenshots at render time. |

## CLI reference (one line each)

```
site-docs init <workspace>           # scaffold a workspace
site-docs capture-auth <workspace>   # cache an authed session (manual-capture strategy)
site-docs calibrate <workspace>      # extract a flow-file from a structured guide
site-docs inspect <workspace>        # discover [data-testid] locators on the live (authed) page
site-docs run <workspace>            # execute flows headless; emit annotations + screenshots
site-docs render <workspace>         # build the static viewer
site-docs lint <workspace>           # static checks across flow-files
site-docs flow-tree <workspace>      # visualise the `extends` graph
site-docs diagnose <workspace>       # halt-context + recommendations after a halt
site-docs style <workspace>          # init/validate style.yaml; --check scans for jargon leaks
site-docs zip <workspace>            # package the doc pack for hand-off
```

`site-docs --help` shows the full surface. Per-command details are in the inline `Notes:` block.

## Key docs

- [**docs/agent-runbook.md**](docs/agent-runbook.md) — the hand-to-an-agent workflow runbook
- [**docs/running-against-an-app-repo.md**](docs/running-against-an-app-repo.md) — human-readable runbook
- [**docs/actionability-contract.md**](docs/actionability-contract.md) — the portable `actionable()` predicate contract, for browser-bridge consumers
- [**docs/browxai-asks.md**](docs/browxai-asks.md) — integration contract with the discovery driver
- [`PHASE-0.md`](PHASE-0.md) — Phase-0 closure summary
- [`PHASE-1.md`](PHASE-1.md) — Phase-1 closure summary + agent-integration-contract postmortem
- [`CHANGELOG.md`](CHANGELOG.md) — `0.1.0` (unreleased) contents · [`RELEASE.md`](RELEASE.md) — gated go-public checklist

The **canonical spec & roadmap** live in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio repo, under `projects/automated-site-documentation-bot/`:

- `spec.md` — what & why
- `roadmap.md` — phases + exit criteria
- `progress.md` — history

Treat the portfolio docs as the source of truth; keep them in sync when implementation forces a design change.

## Contributing

See [**CONTRIBUTING.md**](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
