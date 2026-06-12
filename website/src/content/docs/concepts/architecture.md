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

<div class="docsx-diagram not-content">
  <svg
    class="docsx-loop-svg"
    viewBox="0 0 960 210"
    role="img"
    aria-label="Calibration authors the flow-file once; execution replays it deterministically, looping on every change."
  >
    <defs>
      <marker
        id="dx-arch-arrow"
        viewBox="0 0 10 10"
        refX="8.5"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10 z" fill="var(--sl-color-text-accent)" />
      </marker>
    </defs>
    <line class="dx-link" x1="202" y1="75" x2="262" y2="75" marker-end="url(#dx-arch-arrow)" />
    <line class="dx-link" x1="448" y1="75" x2="508" y2="75" marker-end="url(#dx-arch-arrow)" />
    <line class="dx-link" x1="694" y1="75" x2="754" y2="75" marker-end="url(#dx-arch-arrow)" />
    <path class="dx-link dx-loopback" d="M848 110 C 848 190, 356 190, 356 112" marker-end="url(#dx-arch-arrow)" />
    <text class="dx-loop-label" x="600" y="184" text-anchor="middle">re-run on change, no agent</text>
    <g class="dx-node">
      <rect x="20" y="44" width="180" height="62" rx="12" />
      <text class="dx-node-name" x="38" y="73">host agent</text>
      <text class="dx-node-sub" x="38" y="92">calibration: rare, supervised</text>
    </g>
    <g class="dx-node">
      <rect x="266" y="44" width="180" height="62" rx="12" />
      <text class="dx-node-name" x="284" y="73">flow-file</text>
      <text class="dx-node-sub" x="284" y="92">reviewable YAML, committed</text>
    </g>
    <g class="dx-node">
      <rect x="512" y="44" width="180" height="62" rx="12" />
      <text class="dx-node-name" x="530" y="73">site-docs run</text>
      <text class="dx-node-sub" x="530" y="92">deterministic, zero LLM</text>
    </g>
    <g class="dx-node">
      <rect x="758" y="44" width="180" height="62" rx="12" />
      <text class="dx-node-name" x="776" y="73">doc pack</text>
      <text class="dx-node-sub" x="776" y="92">screenshots + annotations</text>
    </g>
  </svg>
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

**Execution** is deterministic and continuous. `site-docs run` replays the
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
