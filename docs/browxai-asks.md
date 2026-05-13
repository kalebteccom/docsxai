# site-docs ↔ browxai: the integration contract

> Originally written 2026-05-13 morning as a list of pending asks site-docs was sending to the browxai-side agent. Browxai's Phase-1 implementation pass landed all six asks the same day. The **first adoption run** against the first consumer the target app then ran later that day — modest win, surfaced five more asks (#7–#11) about how `snapshot()` / `find()` behave on heavy-SPA targets — **all of which browxai also shipped same day** as a Phase-1.5 pass. This doc now records the **agreed integration contract** across both rounds. Next move: a **re-adoption run** that exercises `find()` against the augmented snapshot. That run is also browxai's headline Phase-1 exit criterion.
>
> Canonical browxai-side status board: `kalebteccom/browxai/docs/first-consumer-asks.md`. Canonical adoption-run report: `kalebteccom/browxai/docs/adoption-report-example-2026-05-13.md`. Portfolio entry: `projects/agent-browser-bridge/progress.md`.

Status legend: ✅ **landed** · 🟡 **partial** (Phase-1 shape landed; remainder is Phase-1.5 / Phase-2) · 📅 **adoption-gated** ("done in code; the proof is the re-adoption run").

---

## Round 1 — pre-shipping asks (sent before browxai had a canonical entrypoint)

### 1. ✅ CDP-attach on the canonical MCP server

`BROWX_ATTACH_CDP=<endpoint>` ships in `src/session/byob.ts`. Attached browser is not-owned (shutdown is `cdp.detach()` only). Loopback-only host check refuses non-`127.0.0.1` / `localhost` / `::1` endpoints. Startup log: `attached=… owner=external`; one-time loud warning naming what's exposed.

### 2. ✅ Stable, non-spike entrypoint

`pnpm browxai` script + `browxai` npm bin → `dist/cli.js`. Env-driven (`BROWX_WORKSPACE`, `BROWX_ATTACH_CDP`, `BROWX_HEADLESS`, `BROWX_TEST_ATTRIBUTES`); no `BROWX_SPIKE_*`. Spike deleted; the curated-vs-raw A/B was dropped in favour of the site-docs adoption run being the real evaluation.

### 3. 📅 `storageState` handoff to `site-docs run`

Falls out of #1: when browxai is attached over CDP, both browxai and `site-docs capture-auth` operate against the same `BrowserContext` and capture-auth already calls Playwright's `BrowserContext.storageState()`. No new MCP tool in Phase 1. The `managed`-mode `dump_storage_state` helper is Phase 2 (only needed when browxai owns the profile and the consumer can't share its CDP).

### 4. 🟡 `find().selectorHint` preference order + `stability` flag

Tiers 1, 2, 5 shipped:

| tier | shape | stability |
|---|---|---|
| 1 | any attr in `BROWX_TEST_ATTRIBUTES` (default `data-testid,data-test,data-cy,data-qa`) — see #8 | `high` |
| 2 | `role=<role>[name="…"]` | `medium` |
| 3 | stable text on a stable role | **Phase-1.5** |
| 4 | `#id` / semantic tag | **Phase-1.5** |
| 5 | `role=<role>` fallback | `low` |

The Phase-1.5 deferrals are explicit in browxai's `docs/phase-1-design.md` §7 — not a gate on the re-adoption run. If `find()` repeatedly only produces tier-5 hints where tier-3 should have caught it, that's the signal to expedite the tier-3 implementation.

### 5. ✅ Visible-rect bbox in `find()` / `snapshot()` evidence

`src/page/bbox.ts`: `getBoundingClientRect` ∩ each `overflow !== visible` ancestor ∩ viewport. Fully clipped → `bbox: null + clipped: true`. **Byte-for-byte parity with site-docs's runtime `boundingBox` computation.**

### 6. ✅ Workspace co-location

`BROWX_WORKSPACE` accepts any absolute path; nesting under a consumer's workspace (`$WORKSPACE/.browxai`) works trivially. Doc-only.

---

## Round 2 — from the 2026-05-13 the target app adoption run

The first end-to-end run against an authed heavy-SPA target (the target app: Reflux + legacy React) found orchestration was solid but `find()` was blunted because the a11y tree on those shapes is sparse, and the target app's interactive elements anchor on `data-type` rather than the assumed `data-testid`. Five concrete asks; browxai shipped all five the same day.

### 7. ✅ `snapshot()` DOM-walk fallback

The a11y tree alone is sparse on heavy-SPA targets. `snapshot()` now runs a DOM walk on every snapshot, picking up interactive elements via `[role], button, a[href], input, select, textarea, [onclick], [tabindex], [contenteditable]` plus any element bearing a configured test attribute. Results merge into the a11y tree under the same root with `[from-dom]` / `[from-both]` source markers. Refs use the existing stable-key scheme so the same node gets the same `eN` across both sources.

**How site-docs reads it.** A line tagged `[from-dom]` was found by DOM walk only — act on the ref normally. `[from-both]` means both sources agreed (a good sign). A snapshot whose header shows `stats: { domWalkNew: … }` with a non-trivial number is the DOM walk earning its keep — that's expected on Reflux/legacy-React targets and isn't a warning.

### 8. ✅ Data-attribute projection + `BROWX_TEST_ATTRIBUTES`

The codebase's test-attribute convention is configurable. Comma-separated, order-sensitive, **first match wins**.

```jsonc
// MCP env block — example with the target app's actual convention
{
  "env": {
    "BROWX_WORKSPACE": "<workspace>/.browxai",
    "BROWX_TEST_ATTRIBUTES": "data-testid,data-type,data-test,data-cy,data-qa"
  }
}
```

Flows through a11y enrichment, the new DOM walk (#7), `selectorHint` tier-1 emission, and locator resolution. Put the most-trusted convention first. Default if unset: `data-testid,data-test,data-cy,data-qa`.

### 9. 🟡 Auto-default `BROWX_ATTACH_CDP` — workaround live

Full auto-detection ("attach when `127.0.0.1:9222` is reachable") is deferred Phase-1.5 polish. The workaround is **dual MCP registration**: register two user-scope entries, one for each mode, and pick the right one at use time.

```bash
# managed (default — browxai launches its own Chromium at $BROWX_WORKSPACE/profile/)
JSON='{"command":"node","args":["<absolute path>/browxai/dist/cli.js"],"env":{"BROWX_WORKSPACE":"<workspace>/.browxai"}}'
claude mcp add-json -s user browxai "$JSON"

# attached (BYOB — attaches to an externally-launched Chrome on loopback:9222)
JSON='{"command":"node","args":["<absolute path>/browxai/dist/cli.js"],"env":{"BROWX_WORKSPACE":"<workspace>/.browxai","BROWX_ATTACH_CDP":"http://127.0.0.1:9222"}}'
claude mcp add-json -s user browxai-attached "$JSON"
```

For site-docs runs, use `browxai-attached` once `site-docs capture-auth --cdp http://localhost:9222` has the Chrome up. Use plain `browxai` for ad-hoc / public-site discovery where no `--cdp` Chrome exists.

### 10. ✅ `selectorHint` tier-1 doesn't gate on a role wrapper

A `<div data-type="x">` (no `role`, no `name`) on a heavy SPA gets `stability: "high"` directly — the emitted hint is `[data-type="x"]` (the matched attribute name from `BROWX_TEST_ATTRIBUTES`), not hardcoded `[data-testid="x"]`. Mechanical transcription of selectorHint into site-docs flow-files works for these elements without a role-wrapper workaround.

### 11. ✅ Low-content snapshot warning

When the a11y tree has fewer than five interactive descendants under root, `snapshot()` emits a `warnings:` block in its header explaining the source mix and pointing at the DOM-walk supplement. Useful early-warning if `find()` returns empty on a page that visually has plenty of interactive content — the snapshot itself tells you the a11y tree was sparse.

---

## What's left: the re-adoption run

> Re-drive site-docs's discovery/calibration end-to-end through the `browxai-attached` MCP registration (attached to the `capture-auth --cdp` Chrome) on a real authed target — this time with `BROWX_TEST_ATTRIBUTES` set for the target codebase (e.g. for the target app: `data-testid,data-type,data-test,data-cy,data-qa`), exercising `find()` against the **augmented** snapshot (a11y + DOM walk) that round 2 shipped.

The run closes browxai Phase 1 if:

- `find()` reliably surfaces ranked candidates for steps where round 1 returned nothing useful (the DOM-walk + test-attr work landing).
- selectorHint transcribes mechanically — most flow-file `locators:` entries come straight from `find().selectorHint` with `stability: high` (tier 1 against the project's test attr) or `medium` (tier 2 role+name).
- The no-trace contract holds: `git -C <app-repo> status` clean after the session.

If tier-3-or-4 hints come up missing on a step the agent confidently wanted them for, that's the signal to expedite Phase-1.5 selectorHint tier-3/4 — file it on the browxai side rather than work around it.

## Deferred to Phase 1.5 / Phase 2 (explicitly out of scope for the re-adoption)

- `dump_storage_state` MCP tool (Phase 2; only needed when browxai owns the profile end-to-end).
- `find().selectorHint` tiers 3 (stable-text-on-stable-role) and 4 (id/semantic).
- `snapshotDelta.scope` (scope-down currently returns full tree with a warning) and `mode: "tree_diff"` (falls back with a warning).
- `await_human` `kind`s beyond `acknowledge` (`confirm` / `choose` / `input` / `pick_element` + the shadow-DOM banner / overlay UI).
- `network_read` as a standalone session-wide buffered stream (per-action `ActionResult.network` is the primary surface for now).
- Auto-default `BROWX_ATTACH_CDP` / `browxai doctor` (the dual-registration recipe is the live workaround).
- No-trace CI test (spawn server with `cwd=/tmp/fake-consumer-repo`; assert cwd untouched) — currently only validated by unit tests on the env-var-rooted resolver.
- Headless-under-CI exercise (`BROWX_HEADLESS=1` works; nobody's run it under CI yet).
- Replacing **execution** mode's Playwright with browxai. Execution stays deterministic, no agent, no MCP. browxai is discovery/calibration only.
