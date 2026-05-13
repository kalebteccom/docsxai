# site-docs ↔ browxai: the integration contract

> Originally written (2026-05-13 morning) as a list of pending asks site-docs was sending to the browxai-side agent. **Rewritten same day** after browxai's Phase-1 implementation pass landed all of them in code (or recorded the deferral): see `projects/agent-browser-bridge/progress.md`'s 2026-05-13 entry "Phase 1: canonical server shipped; awaits adoption run." This doc now records the **agreed integration contract** and what each ask resolved to. Nothing here gates further browxai work; the next move is **site-docs's adoption run** — which is also browxai's headline Phase-1 exit criterion.

Status legend: ✅ **landed** · 🟡 **partial** (Phase-1 shape landed; remainder is Phase-1.5) · 📅 **adoption-gated** ("done in code; the proof is the adoption run").

---

## 1. ✅ CDP-attach on the canonical MCP server — **landed**

**Resolution.** browxai ships `BROWX_ATTACH_CDP=<endpoint>` on its canonical server (`src/session/byob.ts`). Treats the attached browser as not-owned (shutdown is `cdp.detach()` only — never `browser.close()`, never storage reset). Loopback-only host check refuses non-`127.0.0.1` / `localhost` / `::1` endpoints. Logs `attached=… owner=external` on startup and emits a loud one-time warning naming what's exposed.

**How site-docs uses it.** The agent-runbook's Step 3 already opens a `--remote-debugging-port=9222` Chrome for the "one login, not two" option. Step 4 becomes: `BROWX_ATTACH_CDP=http://localhost:9222 pnpm browxai` → host agent drives `find()` / `snapshot()` / action primitives against the same authed page. No second login.

## 2. ✅ Stable, non-spike entrypoint — **landed**

**Resolution.** `pnpm browxai` / `browxai` bin → `dist/cli.js`. Env-driven (`BROWX_WORKSPACE`, `BROWX_ATTACH_CDP`, `BROWX_HEADLESS`); no `BROWX_SPIKE_*` env vars. The spike's `BROWX_SPIKE_SURFACE` two-surface harness is gone (`spike/` directory deleted; the curated-vs-raw A/B that gated Phase 0 was dropped in favour of the site-docs adoption run being the real evaluation — see roadmap decisions-log).

**How site-docs uses it.** Runbook Step 4 and the calibrate skill name `pnpm browxai` (or the bin). No "spike" framing anywhere.

## 3. 📅 storageState handoff to `site-docs run` — **landed (Phase-1 shape); adoption-gated**

**Resolution.** Falls out of #1: when browxai is attached over CDP, both browxai and `site-docs capture-auth` operate against the same `BrowserContext`. `capture-auth --cdp <endpoint>` already calls Playwright's `BrowserContext.storageState()`. No new MCP tool needed in Phase 1. The `managed`-mode `dump_storage_state` helper is the Phase-2 path (used when browxai owns the profile end-to-end and a downstream consumer can't share its CDP).

**How site-docs uses it.** Existing `capture-auth --cdp http://localhost:9222` path keeps doing the right thing. Adoption run validates that the cookies browxai populated land in the captured `storageState` and `site-docs run` replays them deterministically.

## 4. 🟡 `find().selectorHint` quality bar — **tiers 1, 2, 5 landed; tiers 3, 4 are Phase-1.5**

**Resolution.** `src/page/find.ts` implements three of the five tiers in the agreed preference order, each with the stability flag:

| tier | shape | stability |
|---|---|---|
| 1 | `[data-testid="…"]` (and `data-test` / `data-cy` equivalents) | `high` |
| 2 | `role=<role>[name="…"]` | `medium` |
| 3 | stable text on a stable role | **Phase-1.5** |
| 4 | `#id` / semantic tag | **Phase-1.5** |
| 5 | `role=<role>` fallback | `low` |

The Phase-1.5 deferrals are explicit in `docs/phase-1-design.md` §7 ("Phase-1.5 follow-ons"). They're not a gate on the adoption run — when `find()` can only produce a tier-5 hint for a step the agent confidently wanted tier-3 for, that's the signal to expedite the tier-3 implementation.

**How site-docs uses it.** Calibration agent reads `find()` → transcribes `selectorHint` straight into the flow-file's `locators:` block. If `stability: "low"` is the best available, surface that to the user before committing the locator (it likely means the app needs a `data-testid` added — a real client conversation).

## 5. ✅ Visible-rect bbox in `find()` / `snapshot()` — **landed**

**Resolution.** `src/page/bbox.ts`: `getBoundingClientRect` ∩ each `overflow !== visible` ancestor ∩ viewport. Fully clipped → `bbox: null + clipped: true`. **Byte-for-byte parity with site-docs's runtime `boundingBox` computation in `PlaywrightDriver`**, so calibration-time annotation anchor checks match execution-time bbox recording for the same selector.

**How site-docs uses it.** Calibration agent can validate annotation anchors against `find().bbox` *before* committing the flow-file's `annotation.target` — no need to round-trip through `site-docs run` to discover that the halo lands in the void.

## 6. ✅ Workspace co-location — **landed (no code change)**

**Resolution.** `BROWX_WORKSPACE` is an absolute-path env var resolved at startup; nesting under a consumer workspace (`$WORKSPACE/.browxai/`) works trivially. Confirmed in `src/util/workspace.ts`.

**How site-docs uses it.** Agent-runbook's Step 4 sets `BROWX_WORKSPACE="$WORKSPACE/.browxai"` so the operator sees one workspace dir per app — site-docs's `$WORKSPACE` is the top of the tree, browxai's transient state lives under `.browxai/` inside it.

---

## What's left: the adoption run

This is the **only remaining gate** on closing both browxai Phase 1 and the integration contract:

> Drive site-docs's discovery/calibration end-to-end through `pnpm browxai` (attached to the `capture-auth --cdp` Chrome) on a real authed target — same setup as the round-1-through-6 test drives against the target app-2, but with browxai replacing the "drive the `--cdp` Chrome with Playwright directly" / Claude-in-Chrome paths.

What the run produces (each item also lifts something on the browxai side):

- **Demonstrates `BROWX_ATTACH_CDP` against an `httpOnly`-cookied app** (browxai roadmap exit criteria #1, #2, #6).
- **Exercises the full Phase-1 tool surface in anger** (`snapshot` / `find` / action primitives / `await_human({kind:"acknowledge"})` / screenshots / console / network) — currently 20 unit tests pass; the adoption run is the integration test (#3, #4).
- **Verifies "transcribe mechanically" for `find().selectorHint`** — if calibration agents are pulling `selectorHint` straight into flow-files without manual fixup on tier-1/2 hits, ask #4 is closed; the tier-3/4 deferrals get re-prioritised based on how often tier-5 comes up (#8).
- **Verifies the no-trace contract under real consumer-repo conditions** — `git -C <app-repo> status` clean after a session (#9).

If something breaks: file it on the browxai side; if locators flake on a step that should have had tier-3 hints available, that's the signal to expedite Phase-1.5 selectorHint tier-3. Otherwise the run closes Phase 1 and browxai moves to Phase 2 (security hardening + non-site-docs consumer).

## What's deferred to Phase 2 / Phase-1.5 (explicitly out of scope for this run)

- `dump_storage_state` MCP tool (only needed when browxai owns the profile and the consumer can't share its CDP).
- `find().selectorHint` tiers 3 (stable-text-on-stable-role) and 4 (id/semantic).
- `snapshotDelta` scope-down + `mode: "tree_diff"` (currently both fall back to full-tree with a warning).
- `await_human` `kind`s beyond `acknowledge` (`confirm` / `choose` / `input` / `pick_element` + the shadow-DOM banner / overlay UI).
- `network_read` as a standalone session-wide buffered stream.
- Headless-under-CI exercise (the `BROWX_HEADLESS=1` switch works; nobody's run it under CI yet).
- Replacing **execution** mode's Playwright with browxai. Execution stays deterministic, no agent, no MCP. browxai is discovery/calibration only.
