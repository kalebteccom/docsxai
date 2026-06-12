# Automated Site Documentation Bot

> **OSS engine + Claude Code plugin that walks a web application, follows written flows, and emits screenshot-rich user documentation.** LLM-agnostic engine — the host agent supplies inference, the engine never calls a model API.

> **Naming.** Codename `automated-site-documentation-bot` (GitHub repo + `site-docs` CLI). Product name `docsxai` (npm package). The current `docsxai` on npm is a pre-release stub that throws on import — see [`RELEASING.md`](RELEASING.md). The real package ships at `v1.0`.

The keystone bet: write a flow once (by hand, or via an agent-driven calibration cycle); replay it any time after that with **zero agent involvement and zero LLM calls** to produce fresh, deterministic docs. Calibration is rare and human-supervised; execution is cheap and CI-friendly.

## Status

Prototype + validation closed **2026-05-15** — architectural bet proven on a real authed heavy-SPA target. MVP closed **2026-05-19** — engine-complete. The beta surface landed **2026-06-12**: workspace **plugin runtime** (publishers / renderers / lint-rules / auth-strategies), **Confluence ADF export + idempotent publisher plugin**, **GitHub App webhook surface** on the backend, **standalone stdio MCP server**, the full **scripted auth catalogue** (11 strategies), backend **filesystem persistence + OAuth 2.1 PKCE + content-addressed blobs + finalized revisions**, execution **determinism controls** (`environment` clock/locale/viewport/color-scheme) + **deterministic redaction**, the browser-free **burn renderer**, and a **Starlight docs-site emitter** — 760+ tests. The public OSS release is **prepared but deferred by owner decision** — this repo stays private/unpublished; see [`RELEASING.md`](RELEASING.md). Live-credential integration validation (real Confluence space, registered GitHub App) is owner-gated.

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

| package                                                              | role                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kalebtec/docsxai-engine`](packages/engine/)                       | LLM-agnostic engine: flow-file parser + deterministic runtime (environment controls, redaction), the plugin runtime, the 11-strategy auth catalogue, pure exporters (ADF), the full `site-docs` CLI. |
| [`@kalebtec/docsxai-plugin`](packages/plugin/)                       | Claude Code plugin — calibrate + diagnose skills; run/render/login/push/pull/plugins/export commands. The recommended invocation surface for agent-driven workflows.                                 |
| [`@kalebtec/docsxai-mcp`](packages/mcp/)                             | Standalone stdio MCP server: calibration meta-orchestration + doc-pack introspection for any MCP-speaking host (no browser primitives — browxai owns discovery).                                     |
| [`@kalebtec/docsxai-backend`](packages/backend/)                     | Doc-pack persistence service: FS or in-memory store, content-addressed blobs, finalized linear-immutable revisions, OAuth 2.1 + PKCE, encrypted auth-cache relay, GitHub App webhook surface.        |
| [`@kalebtec/docsxai-skill`](packages/skill/)                         | Optional vendorable `.claude/skills/` fallback; delegates to the installed plugin. For teams that prefer version-pinning in the consumer repo.                                                       |
| [`@kalebtec/docsxai-viewer`](packages/viewer/)                       | Rendering surface: interactive single-file viewer, browser-free `burn` renderer (baked annotations), Astro Starlight docs-site emitter.                                                              |
| [`@kalebtec/docsxai-plugin-confluence`](packages/plugin-confluence/) | First-party publisher plugin — idempotent Confluence Cloud REST v2 push (`confluence:push`), capability-gated egress.                                                                                |
| [`@kalebtec/docsxai-plugin-starlight`](packages/plugin-starlight/)   | First-party renderer plugin — Starlight site emission (`starlight:site`).                                                                                                                            |

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
site-docs zip <workspace>            # package the doc pack for hand-off (deterministic, in-process)
site-docs plugins <list|info|sync>   # workspace plugin runtime: status, manifests, sha256 lock
site-docs export adf <workspace>     # pure Confluence ADF projection (agentic-path artifact)
site-docs login [--oauth] / push / pull   # backend persistence (OAuth 2.1 PKCE or CI bearer)
```

`site-docs --help` shows the full surface. Per-command details are in the inline `Notes:` block.

## Key docs

- [**docs/agent-runbook.md**](docs/agent-runbook.md) — the hand-to-an-agent workflow runbook
- [**docs/running-against-an-app-repo.md**](docs/running-against-an-app-repo.md) — human-readable runbook
- [**docs/actionability-contract.md**](docs/actionability-contract.md) — the portable `actionable()` predicate contract, for browser-bridge consumers
- [**docs/browxai-asks.md**](docs/browxai-asks.md) — integration contract with the discovery driver
- [`docs/archive/phase-plans/`](docs/archive/phase-plans/) — archived closure summaries (prototype + MVP) and agent-integration-contract postmortem
- [`CHANGELOG.md`](CHANGELOG.md) — `0.1.0` (unreleased) contents · [`RELEASING.md`](RELEASING.md) — gated go-public checklist

The **canonical spec & roadmap** live in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio repo, under `projects/automated-site-documentation-bot/`:

- `spec.md` — what & why
- `roadmap.md` — phases + exit criteria
- `progress.md` — history

Treat the portfolio docs as the source of truth; keep them in sync when implementation forces a design change.

## Contributing

See [**CONTRIBUTING.md**](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
