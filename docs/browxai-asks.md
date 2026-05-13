# site-docs → browxai: the exact ask

> Concrete capabilities **site-docs** (the first consumer) needs **browxai** to grow so that site-docs's discovery / calibration stage can drive browxai end-to-end on **real, authenticated target apps** — not just the public-site Phase-0 spike scope. Each item below names the gap, why site-docs hits it, the minimum shape that closes it, and how site-docs will adopt it once it lands.

The browxai design (`projects/agent-browser-bridge/spec.md` in the portfolio; `docs/phase-1-design.md` in the browxai repo) already anticipates most of this — the asks are about **prioritisation** and **interface shape**, not new design surface.

Status legend: **🔴 blocker** = site-docs can't adopt browxai for real-app discovery without it · **🟡 important** = adoption works without it but is awkward / brittle · **🟢 ergonomic** = nice-to-have, doesn't gate adoption.

---

## 1. 🔴 Attach the canonical MCP server to an existing CDP endpoint

**Gap.** The Phase-0 spike launches its own managed-profile Chromium and is explicitly "no login, no auth, no BYOB" (per `AGENT-RUNBOOK.md`). site-docs already runs an instrumented Chrome via `site-docs capture-auth` (persistent profile under the workspace, `--remote-debugging-port`-style attach available), and the operator has already logged in there. If browxai launches its *own* second Chromium, the operator either logs in twice or the second browser has no session — neither works for site-docs discovery.

**Why this is the unblocker.** site-docs's whole auth story (the `manual-capture` strategy, the persistent profile, `--cdp`) is purpose-built so *one* Chrome holds the auth. browxai joining that Chrome is dramatically simpler than browxai duplicating it.

**Minimum shape that closes it.**
- Startup env var on the *canonical* (post-spike) MCP server — e.g. `BROWX_ATTACH_CDP=http://localhost:9222` — that makes browxai call `chromium.connectOverCDP(endpoint)` instead of launching. Treat the attached browser as not-owned: don't close it on shutdown, don't reset its storage.
- Document the trade-off explicitly: when attached, browxai inherits the host Chrome's security posture (loopback CDP only, still). The spec already calls this out as the BYOB path; this is just bringing it from Phase-1 design into actual implementation.

**How site-docs adopts it.** The agent-runbook's Step 3 (`capture-auth`) already opens a `--remote-debugging-port=9222` Chrome for the "one login, not two" option. Step 4 (discovery) becomes: `BROWX_ATTACH_CDP=http://localhost:9222 <spawn browxai MCP server>` → the host agent drives `find()` / `snapshot()` / action primitives against the *authed* page. No second login, no `httpOnly`-cookie translation.

## 2. 🔴 A stable, non-spike entrypoint for the curated surface

**Gap.** Today's invocation is `pnpm --silent spike` (per `AGENT-RUNBOOK.md`'s `.mcp.json` example); the runbook calls this "throwaway." site-docs's agent-runbook can't sensibly tell engineers to depend on a command we've told them is going away.

**Minimum shape that closes it.** Promote the curated surface to a stable entry — a `pnpm browxai` script (or `npx @kalebtec/browxai`, once published) that wires up the same MCP server with the **curated** surface as the default and no `BROWX_SPIKE_*` env vars required. The Phase-0 verdict can still pivot the design; the *entrypoint name* doesn't have to be on the chopping block to do that.

**How site-docs adopts it.** Step 4 of the agent-runbook references this command name. When the Phase-0 verdict lands (GO / NO-GO / MIXED), the entrypoint stays; only the tools behind it move.

## 3. 🔴 Hand off `storageState` to the deterministic (headless) `run` stage

**Gap.** site-docs has two stages with different needs: **discovery** (the head-full, attached, agent-driven walk where browxai shines) and **`site-docs run`** (deterministic, headless Playwright, no agent context). The headless run needs the **same `storageState`** the discovery session is using — otherwise the operator logs in twice (once for browxai, once for `capture-auth`).

**Minimum shape that closes it.** Either of these works; pick one:
- **(a, simpler)** When attached over CDP (ask #1), site-docs's own `capture-auth` reads the storageState off that same Chrome — browxai doesn't need to expose anything extra. This already works today via Playwright's `BrowserContext.storageState()`; site-docs's `manual-capture` does exactly this.
- **(b, if browxai owns the profile)** browxai exposes an MCP tool — e.g. `dump_storage_state({ outputPath })` — that writes Playwright's standard `storageState` JSON shape (cookies + origins/localStorage) to a path the agent passes. site-docs's `capture-auth` then either reads that file or skips its own capture in favour of it.

**Preference.** (a) is what falls out of the Phase-1 design if we get ask #1 — no new MCP tool required. We can defer (b) to Phase 2.

**How site-docs adopts it.** Site-docs's existing `capture-auth --cdp http://localhost:9222` path already does the right thing if browxai is attached to that same Chrome. No site-docs change needed beyond the runbook step ordering.

## 4. 🟡 `find().selectorHint` favours stable selectors, in a documented preference order

**Gap.** site-docs transcribes locators from discovery directly into flow-files (`locators: { play_button: '[data-testid="play-recap"]' }`). These selectors run against the live app at execution time forever after — if they're brittle (nth-child, generated class names, indices), flow-files break on the next UI change. `find()` returns a `selectorHint` already; the question is the *quality bar* on what that hint contains.

**Minimum shape that closes it.** Document and enforce a preference order for `selectorHint`:
1. `[data-testid="…"]` (or `[data-test="…"]` / `[data-cy="…"]` — any project-conventional `data-*` test attribute).
2. Role + accessible name (`getByRole('button', { name: 'Play' })` shape, or its CSS-equivalent if the consumer is selector-only).
3. Stable text content on a stable role.
4. Stable structural selectors (id, semantic tag).
5. *Only as a last resort*, positional selectors (`:nth-child`, descendant chains with generated classes).

When `find()` can't get above tier 4, surface that in the response (e.g. `selectorHint.stability: "low"`) so the calibration agent can flag it for a human or pin a `data-testid` ask back to the app team.

**How site-docs adopts it.** Calibration agents already get told to prefer role/text/test-id (see `packages/plugin/skills/calibrate/SKILL.md`). With the hint quality bar, transcription becomes mechanical — `find()` → flow-file `locators:` block, no manual re-selecting.

## 5. 🟡 Visible-rect bbox in `find()` / `snapshot()` results

**Gap.** site-docs already computes a **visible-rect** bounding box in its Playwright driver — `boundingBox` intersected with each `overflow !== visible` ancestor and the viewport, returning null if the element is fully clipped. This is what makes annotations point at the *visible* part of an element in a scrollable container (the round-6 fix). browxai's `find()` returns a `bbox`, but if it's the raw element rect, annotation captured during calibration won't match what the headless `run` will record — same selector, different bbox.

**Minimum shape that closes it.** `find()` and `snapshot()` candidate bbox is the *visible* rect by the same definition. If fully clipped: return `bbox: null` with a `clipped: true` flag, not the raw rect.

**How site-docs adopts it.** Cross-checks during calibration get cheaper — the agent can validate that the annotation anchor it just transcribed is on-screen, before committing the flow-file. No site-docs code change required; the engine's runtime bbox computation stays as-is.

## 6. 🟢 Workspace co-location with the consumer (site-docs)

**Gap.** browxai's no-trace contract puts transient state under `BROWX_WORKSPACE` (default `~/.browxai/`); site-docs's no-trace contract puts everything under `$WORKSPACE` (per-app, outside the app repo). For an engineer documenting one app, that's now two workspace dirs to remember.

**Minimum shape that closes it.** Allow (but don't require) `BROWX_WORKSPACE=$SITE_DOCS_WORKSPACE/.browxai/`. browxai already lets the consumer name the workspace; this is a documentation ask: the site-docs agent-runbook will set `BROWX_WORKSPACE` to a subdir of `$WORKSPACE` so the operator sees one tree per app. browxai just needs to keep the env-var-rooted-everything discipline it already has so subdir nesting doesn't surprise anyone.

**How site-docs adopts it.** Runbook recipe; no code change either side.

---

## Sequencing the asks

If browxai-side capacity is the bottleneck, the order is:

1. **#1 (CDP-attach)** — without this, the other asks are theoretical, because site-docs can't drive browxai on an authed app at all.
2. **#2 (stable entrypoint)** — trivial; can ship the same week as #1.
3. **#3 (storage-state)** — falls out of #1 for free; tracked separately because Phase-2 caching changes the answer.
4. **#4 (selectorHint quality)** — likely landing as part of the Phase-1 `find()` implementation anyway; flagging the bar here so it's not litigated later.
5. **#5 (visible-rect bbox)** — small, but worth tracking so it doesn't fall off.
6. **#6 (workspace co-location)** — documentation; lowest priority.

Once #1–#3 land, site-docs's `docs/agent-runbook.md` Step 4 swaps from "drive the `--cdp` Chrome with Playwright directly" to "spawn browxai (attached to that same Chrome) and drive it via MCP" — the change site-docs is already pre-staging.

## Out of scope for this ask

- Anything Phase-2-shaped on the browxai roadmap (full security/sandbox model, learned `find()` ranking, headless CI lifecycle for browxai itself, multi-tenant offerings).
- Replacing the **execution** mode's Playwright with browxai. Execution is deterministic and stays on raw Playwright — no agent, no MCP, no inference. browxai is for **discovery / calibration only**.
- Anything that would block the Phase-0 verdict from landing on its own timeline. These asks are *additive* to that verdict, not a precondition.
