# Automated Site Documentation Bot

OSS engine + Claude Code plugin that walks a web application, follows written flows, and
emits screenshot-rich user documentation — with an LLM-agnostic engine (the host agent
supplies inference; the engine never calls a model API).

Two-mode architecture:

- **Calibration** (AI-assisted, rare) — discovery → mapping+testing → commit, producing a
  self-sufficient *doc pack* (flow-files + `annotations.json` + `style.yaml` + markdown +
  screenshots + locator manifest + auth-strategy descriptor).
- **Execution** (deterministic, continuous) — replays the doc pack through headless
  Playwright with zero LLM involvement and re-emits fresh docs. CI-friendly.

First target: a representative consumer-grade SPA — multiple chained user flows in a single feature area, documented end-to-end as one consolidated guide.

## Where the design lives

The **canonical spec and roadmap** are in the `project-ideas` portfolio repo, under
`projects/automated-site-documentation-bot/` — `spec.md` (what & why), `roadmap.md`
(phases), `progress.md` (history). This repo is the *implementation*; treat the portfolio
docs as the source of truth and keep them in sync when implementation forces a design
change.

Current status: **Phase 0 — prototype & validation.** See [`PHASE-0.md`](PHASE-0.md).

## Layout

```
packages/
  engine/    @kalebtec/site-docs-engine   — calibration pipeline + flow-file runtime + auth-strategy layer
  plugin/    @kalebtec/site-docs-plugin    — Claude Code plugin (skills + commands + MCP); the invocation surface
  backend/   @kalebtec/site-docs-backend   — authenticated doc-pack persistence; REST + per-resource; OAuth 2.1
  skill/     @kalebtec/site-docs-skill     — optional colocated .claude/skills/ fallback (delegates to the plugin)
  viewer/    @kalebtec/site-docs-viewer    — Vitest-based interactive docs-app generator
docs/        design notes / ADRs
examples/    public toy-site flows + fixtures for Phase-0 prototyping
```

## Dev setup

```bash
corepack enable          # provides pnpm
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Node 20+. License: Apache-2.0.
