---
title: Architecture
description: The two-mode split between rare AI-assisted calibration and deterministic agent-free execution, the engine-never-calls-models contract, and the BrowserDriver seam that keeps the engine portable.
---

docsxai is a small family of packages around one deterministic core. The
engine owns the flow-file parser, the Playwright-backed runtime, the
calibration aids (`lint`, `diagnose`, `flow-tree`, `style`), the plugin
runtime, and the target-site auth strategies. Everything else orchestrates
around it: the Claude Code plugin and the standalone MCP server are invocation
surfaces over the engine, the backend persists doc packs, the viewer renders
them. None of the satellites adds browser primitives of its own.

## The two-mode split

<div class="docsx-modes not-content" role="img" aria-label="The two-mode split. Calibration is rare and agent-assisted: a host agent drives discovery and commits a reviewable flow-file. Execution is continuous and agent-free: the deterministic engine core replays that flow-file through the BrowserDriver seam, with no model in the loop, emitting a doc pack and looping on every change.">
<div class="dxm-grid" aria-hidden="true">
<section class="dxm-lane dxm-lane--cal">
<header class="dxm-lane-head"><span class="dxm-lane-tag">calibration</span><span class="dxm-lane-note">rare · agent-assisted</span></header>
<div class="dxm-box"><span class="dxm-box-name">host agent</span><span class="dxm-box-sub">drives discovery, picks one locator per step</span></div>
<div class="dxm-down" aria-hidden="true"><svg viewBox="0 0 24 40"><path d="M12 2 V32" /><path d="M6 28 L12 36 L18 28" /></svg></div>
<div class="dxm-box dxm-box--art"><span class="dxm-box-name">flow-file</span><span class="dxm-box-sub">reviewable YAML, committed to the repo</span></div>
</section>
<section class="dxm-lane dxm-lane--exec">
<header class="dxm-lane-head"><span class="dxm-lane-tag dxm-lane-tag--exec">execution</span><span class="dxm-lane-note">continuous · agent-free</span></header>
<div class="dxm-core"><span class="dxm-core-name">engine core</span><span class="dxm-core-sub">deterministic runtime · never calls a model</span><div class="dxm-seam"><span class="dxm-seam-label">BrowserDriver seam</span><span class="dxm-seam-chip">Playwright</span></div></div>
<div class="dxm-down" aria-hidden="true"><svg viewBox="0 0 24 40"><path d="M12 2 V32" /><path d="M6 28 L12 36 L18 28" /></svg></div>
<div class="dxm-box dxm-box--out"><span class="dxm-box-name">doc pack</span><span class="dxm-box-sub">clean screenshots + annotations, byte-identical</span></div>
<p class="dxm-loop"><svg class="dxm-loop-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12 A8 8 0 1 1 17.5 6.2" /><path d="M17.8 2.5 L18 6.4 L14.2 6" /></svg><span>re-run on every change · no agent</span></p>
</section>
<span class="dxm-handoff" aria-hidden="true"><svg viewBox="0 0 60 24"><path d="M2 12 H48" /><path d="M44 6 L54 12 L44 18" /></svg></span>
</div>
</div>

**Calibration** is AI-assisted and rare. A host agent - through the
[Claude Code plugin](/packages/plugin/) or the [MCP server](/reference/mcp-tools/) -
drives discovery against the live app (that part is
[browxai](/concepts/browxai-ecosystem/)'s surface), picks one canonical
locator per step, and commits the result as a flow-file. The engine helps at
write-time, not run-time: `lint` catches authoring mistakes statically,
`diagnose` packages halt context into typed recommendations, `flow-tree`
visualises the `extends` graph, and the `actionable()` probe says whether a
selector is clickable before the step is ever written down.

**Execution** is deterministic and continuous. `docsxai run` replays the
flow through headless Chromium with no agent and no MCP in the loop. The
`environment` block (frozen clock, pinned locale, timezone, viewport, color
scheme) makes the same flow against the same target state produce
byte-identical screenshots; a keystone test enforces that against real
Chromium on every change to the runtime.

## The engine never calls a model

The engine has no model-provider SDK anywhere in its dependency tree, and the
project treats adding one as a contract violation. Calibration-time inference
is supplied by whatever host agent you already run; execution-time inference
does not exist. Two consequences worth internalising:

- **Halts are a feature.** When a locator or success check fails, the run
  halts with a `[cause: ...]` prefix instead of asking a model to guess a
  fallback. Drift is a signal to recalibrate, not to absorb silently.
- **The cost story stays honest.** A doc refresh costs one headless browser
  session, so running it per commit is no more exotic than running your
  Playwright suite.

## The BrowserDriver seam

The runtime is written against a thin `BrowserDriver` interface, not against
Playwright directly: `goto`, `click`, `fill`, the wait primitives, the
success-check reads, `screenshot`, `boundingBox`, and the write-time
`actionable(selector)` probe. The one Playwright integration point
(`PlaywrightDriver`) stays small and is the engine's single Playwright import
site. This seam is what lets browxai slot in as the model-agnostic discovery
driver during calibration while execution keeps its own raw Playwright
sessions - and it keeps the runtime testable without a browser at all.

## The package family

| Package                                           | Role                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| [engine](/packages/engine/)                       | Parser, runtime, CLI, auth strategies, plugin runtime, exporters.        |
| [plugin](/packages/plugin/)                       | Claude Code plugin: calibrate + diagnose skills, deterministic commands. |
| [mcp](/packages/mcp/)                             | Stdio MCP server for any host: orchestration + doc-pack introspection.   |
| [backend](/packages/backend/)                     | Doc-pack persistence: revisions, blobs, OAuth 2.1, GitHub webhook.       |
| [viewer](/packages/viewer/)                       | Interactive viewer, browser-free burn renderer, Starlight emitter.       |
| [plugin-confluence](/packages/plugin-confluence/) | Publisher plugin: idempotent Confluence Cloud push.                      |
| [plugin-starlight](/packages/plugin-starlight/)   | Renderer plugin: production Starlight docs site.                         |

Every arrow in that table points inward: surfaces wrap the engine, the engine
wraps `BrowserDriver`, and nothing on the execution path knows an agent
exists.
