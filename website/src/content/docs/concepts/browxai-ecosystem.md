---
title: The browxai ecosystem
description: Where docsxai ends and browxai begins - live-page discovery during calibration, the CDP-attach calibration shape, test-attribute configuration, and the recording accelerator.
---

docsxai deliberately ships no live-page discovery surface: no click, fill, or
inspect on an arbitrary page from an agent's hands. During calibration that
job belongs to [browxai](https://github.com/kalebteccom/browxai), an
MCP-native browser bridge built for agents. The boundary is sharp and worth
stating plainly:

- **browxai owns discovery.** During calibration, the host agent uses
  browxai's `find()` (ranked candidate locators with selector hints, stability
  ratings, and visible-rect bounding boxes), `snapshot()` (a compact
  accessibility tree augmented with a DOM walk, so heavy-SPA targets are not
  sparse), and its action primitives to explore the live app and pick
  locators.
- **docsxai owns execution and doc emission.** `docsxai run` replays the
  committed flow-file through the engine's own Playwright sessions - never
  through browxai, never through an agent. The doc pack, the viewer, the
  drift reports, and the publishers are all docsxai's side.
- **The docsxai MCP server exposes meta-orchestration only.** Its
  [fourteen tools](/reference/mcp-tools/) run flows, lint, diagnose, and
  introspect the pack; none of them is a browser primitive. Keeping the two
  MCP surfaces disjoint is what keeps `docsxai run` reproducible.

The two tools meet at the
[actionability contract](/reference/actionability/): a shared element-state
vocabulary (`actionable`, `not-found`, `multiple-matches`, `detached`,
`not-visible`, `off-screen`, `covered`, `disabled`) returned by the engine's
`BrowserDriver.actionable(selector)` and mirrored on browxai's `find()`
results. A calibration agent learns at write-time whether a selector is
fillable, clickable, or needs scoping - instead of finding out at run-time
via a halt with the same word in its `[cause: ...]` prefix.

<div class="docsx-boundary not-content" role="img" aria-label="The browxai and docsxai boundary. browxai owns live-page discovery and runs only during calibration. docsxai owns deterministic execution and doc emission. The two meet at the shared actionability contract: an element-state vocabulary returned by the engine and mirrored on browxai's find results.">
<div class="dxb-grid" aria-hidden="true">
<section class="dxb-side dxb-side--brow"><span class="dxb-side-tag">browxai</span><span class="dxb-side-role">live-page discovery</span><ul class="dxb-list"><li>find() ranked locators</li><li>snapshot() a11y tree</li><li>action primitives</li></ul><span class="dxb-when">calibration only</span></section>
<div class="dxb-seam"><span class="dxb-seam-rail" aria-hidden="true"></span><span class="dxb-seam-pill">actionability contract</span><span class="dxb-seam-sub">shared element-state vocabulary</span></div>
<section class="dxb-side dxb-side--docs"><span class="dxb-side-tag dxb-side-tag--docs">docsxai</span><span class="dxb-side-role">execution + doc emission</span><ul class="dxb-list"><li>run replays the flow-file</li><li>own Playwright sessions</li><li>pack, viewer, drift, publish</li></ul><span class="dxb-when dxb-when--docs">every run · agent-free</span></section>
</div>
</div>

## The CDP-attach calibration shape

The recommended calibration setup is one shared Chrome, attached over CDP by
everything that needs it (bring your own browser):

1. Start a debug-port Chrome - `browxai chrome start --insecure` owns the
   lifecycle, or launch one manually with `--remote-debugging-port=9222`.
2. The engineer logs in once, in that Chrome.
3. `docsxai capture-auth <workspace> --cdp http://localhost:9222` reads the
   session from it without closing it.
4. browxai's attached-mode MCP entry drives discovery against the same
   Chrome, so the agent sees the authed app the engineer sees.
5. `docsxai run --flow <name> --start-from <step> --cdp http://localhost:9222`
   validates each new step in seconds against the warm page state.

One login, one browser, both tools. `browxai init <workspace>/.browxai`
bootstraps the MCP registration for both managed and attached modes, and
`browxai doctor` health-checks the wiring.

## Test attributes

browxai resolves locators against a configurable test-attribute convention:
`BROWX_TEST_ATTRIBUTES`, comma-separated and order-sensitive, first match
wins. The default is `data-testid,data-test,data-cy,data-qa`. If the target
codebase anchors interactivity on something else - say `data-type` - put it
in the list, and browxai's selector hints emit that attribute directly. The
hints transcribe mechanically into flow-file locators, which is the point:
what the agent saw rank first is what the engine replays forever.

## The recording accelerator

Instead of authoring `flows/<name>.flow.yaml` step by step, drive the walk
through browxai's action tools while a recording is active:
`start_recording({ flowName })`, act through the page, attach callout copy
per step with `record_annotate({ copy, arrow })`, then `end_recording()`
emits a docsxai-flavoured YAML draft - `locators:` plus `steps:` with
hint-derived targets. Review it, fix anything content-keyed or
hidden-duplicate-prone, lint it, and commit it. The draft is a starting
point, not a finished flow; the review pass is where calibration earns its
keep.

## What never crosses the boundary

Execution never grows a browxai dependency, and the engine never re-exposes
browxai primitives through its own MCP server. If browxai is down, replays
are unaffected; if you calibrate with a different MCP browser bridge
entirely, the engine cannot tell. The flow-file is the only thing that
crosses.
