---
title: Introduction
description: What docsxai is, the two-mode bet behind it, how the naming fits together, and when to reach for it instead of a screen recorder or a test generator.
---

docsxai walks a running web application, follows written flows, and emits
screenshot-rich user documentation. You describe a user journey once as a
[flow-file](/reference/flow-file/); the `docsxai` CLI replays it through
headless Chromium, captures clean screenshots, places halos and callouts from
the flow's annotations, and renders a publishable doc pack. When the UI
changes, you re-run. The docs are a build artifact: the flow is the source,
the rendered pack is the output, a re-run is the refresh.

## The two-mode bet

The architecture splits into two modes, and the split is the product:

- **Calibration** is AI-assisted and rare. A host agent - Claude Code, Codex,
  anything that speaks MCP - explores the live app, picks canonical locators,
  and authors the flow-file. This happens once per flow, and again only when
  the app drifts out from under it.
- **Execution** is deterministic and continuous. `docsxai run` replays the
  flow with zero agent involvement and zero LLM calls. Same flow-file, same
  target state, byte-identical screenshots - enforced by a keystone test
  against real Chromium.

The engine never calls a model API. That boundary is load-bearing: per-commit
LLM runs would be untenable; per-commit Playwright runs are standard CI
practice. You pay for inference once at authoring time, then every refresh is
as cheap as a test run. [Architecture](/concepts/architecture/) covers how the
pieces enforce this.

## Naming

One name everywhere:

| Name         | What it names                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docsxai`    | The product, the GitHub repo `kalebteccom/docsxai`, this site, and the CLI binary.                                                        |
| `DOCSX_*`    | The env-var prefix; the workspace config is `.docsxai.json`, schema ids are `docsxai/*@N`.                                                |
| `@docsxai/*` | The npm packages: `@docsxai/engine`, `@docsxai/viewer`, `@docsxai/plugin`, `@docsxai/mcp`, `@docsxai/backend`, and the publisher plugins. |

When you type a command, it is `docsxai`. When you install a package, it is
`@docsxai/something`. Both name the same engine.

## When to use it (and when not to)

A screen recorder or a record-and-replay generator captures what you did once;
the recording rots silently when the UI moves, and refreshing means
re-recording by hand. docsxai is the better tool when the documentation has to
stay current without a human in the loop: the flow-file is a reviewable text
artifact, the replay is deterministic enough to gate CI on pixel-level drift
(`docsxai diff --fail-on warn`), and a halted step names exactly which
locator or assertion broke instead of handing you a stale video. The same
calibration loop works from any MCP-speaking agent, so authoring is cheap too.
If all you need is a one-off capture of a UI that will never change, a
recorder is less setup. If you need living docs for an app that ships weekly,
write the flow once and let CI do the rest.

## Where to go next

- [Installation](/getting-started/installation/) - get `docsxai` onto your PATH.
- [Quickstart](/getting-started/quickstart/) - init a workspace, write a first flow, run and render it.
- [The doc pack](/concepts/doc-pack/) - what a run actually produces on disk.
