# docsxai ↔ browxai: the integration contract

> Historical sections below (the 2026-05 waves and re-adoption record) keep the `site-docs` name the product carried at the time; it was renamed to `docsxai` on 2026-06-12.

> **Status (2026-05-15): closed.** First-integration contract met on both sides. The re-adoption run against the first-consumer target app on 2026-05-15 was a WIN — one new flow (`recap-edit-timing`) calibrated end-to-end through `browxai-attached`, eight Recap flows now in the workspace, no-trace contract held, replay determinism through `site-docs run` intact. Five non-architectural follow-on asks (#12–#16) tracked below.
>
> Written 2026-05-13 morning as a list of pending pre-shipping asks (initial wave, #1–#6). Browxai's first-integration implementation pass landed all six the same day. The **first adoption run** later that day surfaced five more asks (#7–#11) about heavy-SPA `snapshot()` / `find()` behaviour — all shipped same day as a follow-up integration pass. The re-adoption confirmed those fixes work and surfaced #12–#16 as polish, not blockers.
>
> **Canonical operational reference**: `kalebteccom/browxai` → `harness/driving-browxai/SKILL.md` + `docs/tool-reference.md` (formerly `AGENT-RUNBOOK.md`) — for snapshot output legend (`stats:`, `warnings:`, `[from-dom]` / `[from-both]` markers), locator-disambiguation idioms (`:visible`, `nth-match`), `stability` semantics (snapshot-disambiguator vs. deploy-stable), and known-issue workarounds. This doc does **not** duplicate that content; it tracks the contract shape only.
>
> Other canonical sources: `kalebteccom/browxai/docs/ai-context/adopter-reports/` (per-ask status boards + field reports; formerly `docs/first-consumer-asks.md`); adoption reports `kalebteccom/browxai/docs/adoption-report-example-2026-05-{13,15}.md`; portfolio entry `projects/agent-browser-bridge/progress.md`.

Status legend: ✅ **landed** · 🟡 **partial** (initial shape landed; remainder follow-up / post-MVP) · 📅 **adoption-gated**.

---

## Initial wave — pre-shipping asks (sent before browxai had a canonical entrypoint)

### 1. ✅ CDP-attach on the canonical MCP server

`BROWX_ATTACH_CDP=<endpoint>` ships in `src/session/byob.ts`. Attached browser is not-owned (shutdown is `cdp.detach()` only). Loopback-only host check refuses non-`127.0.0.1` / `localhost` / `::1` endpoints. Startup log: `attached=… owner=external`; one-time loud warning naming what's exposed.

### 2. ✅ Stable, non-spike entrypoint

`pnpm browxai` script + `browxai` npm bin → `dist/cli.js`. Env-driven (`BROWX_WORKSPACE`, `BROWX_ATTACH_CDP`, `BROWX_HEADLESS`, `BROWX_TEST_ATTRIBUTES`); no `BROWX_SPIKE_*`. Spike deleted; the curated-vs-raw A/B was dropped in favour of the site-docs adoption run being the real evaluation.

### 3. 📅 `storageState` handoff to `site-docs run`

Falls out of #1: when browxai is attached over CDP, both browxai and `site-docs capture-auth` operate against the same `BrowserContext` and capture-auth already calls Playwright's `BrowserContext.storageState()`. No new MCP tool needed initially. The `managed`-mode `dump_storage_state` helper is later work (only needed when browxai owns the profile and the consumer can't share its CDP).

### 4. 🟡 `find().selectorHint` preference order + `stability` flag

Tiers 1, 2, 5 shipped:

| tier | shape                                                                                          | stability     |
| ---- | ---------------------------------------------------------------------------------------------- | ------------- |
| 1    | any attr in `BROWX_TEST_ATTRIBUTES` (default `data-testid,data-test,data-cy,data-qa`) — see #8 | `high`        |
| 2    | `role=<role>[name="…"]`                                                                        | `medium`      |
| 3    | stable text on a stable role                                                                   | **follow-up** |
| 4    | `#id` / semantic tag                                                                           | **follow-up** |
| 5    | `role=<role>` fallback                                                                         | `low`         |

The follow-up deferrals are explicit in browxai's design notes — not a gate on the re-adoption run. If `find()` repeatedly only produces tier-5 hints where tier-3 should have caught it, that's the signal to expedite the tier-3 implementation.

### 5. ✅ Visible-rect bbox in `find()` / `snapshot()` evidence

`src/page/bbox.ts`: `getBoundingClientRect` ∩ each `overflow !== visible` ancestor ∩ viewport. Fully clipped → `bbox: null + clipped: true`. **Byte-for-byte parity with site-docs's runtime `boundingBox` computation.**

### 6. ✅ Workspace co-location

`BROWX_WORKSPACE` accepts any absolute path; nesting under a consumer's workspace (`$WORKSPACE/.browxai`) works trivially. Doc-only.

---

## Follow-up wave — from the 2026-05-13 first-consumer adoption run

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
    "BROWX_TEST_ATTRIBUTES": "data-testid,data-type,data-test,data-cy,data-qa",
  },
}
```

Flows through a11y enrichment, the new DOM walk (#7), `selectorHint` tier-1 emission, and locator resolution. Put the most-trusted convention first. Default if unset: `data-testid,data-test,data-cy,data-qa`.

### 9. 🟡 Auto-default `BROWX_ATTACH_CDP` — workaround live

Full auto-detection ("attach when `127.0.0.1:9222` is reachable") is deferred polish work. The workaround is **dual MCP registration**: register two user-scope entries, one for each mode, and pick the right one at use time.

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

---

## Re-adoption verdict (2026-05-15): WIN, first-integration contract closed

Re-ran site-docs discovery/calibration end-to-end through `browxai-attached` against authed the target app, with `BROWX_TEST_ATTRIBUTES=data-testid,data-type,data-test,data-cy,data-qa`. Scope: author one new flow (`recap-edit-timing` — Recap Flow 3 "Edit Script Timing"). Result: flow file authored entirely through browxai's MCP surface, replayed cleanly through `site-docs run` (headless, no browxai dependency), no-trace contract held. First-integration exit criteria met both sides. Full report: `kalebteccom/browxai/docs/adoption-report-example-2026-05-15.md`.

Five non-architectural follow-on asks surfaced; none gates further site-docs work, none block adoption against new targets. Their canonical home is `kalebteccom/browxai/docs/ai-context/adopter-reports/` (re-adoption table) and they'll be addressed on the browxai side as polish cleanup or fold into later work. Listed here for contract completeness:

### 12. 🟡 `wait_for.timeoutMs` schema cap (currently 120 s)

Backend-async ops (script generation, translation, TTS) routinely exceed the 120 000 ms cap. Site-docs's own flow-file `timeout_ms` is unbounded; the discovery-side primitive should at least match. Suggested: raise to ~600 000 ms, or add `pollIntervalMs`, or document the polling idiom. Schema-only change, no semantic risk.

### 13. 🟡 `selectorHint` disambiguation for duplicate DOM matches

When `find()` returns the visible candidate via its interaction filter but the bare `[data-type="x"]` matches multiple DOM nodes (visible + hidden duplicate), the emitted hint should disambiguate (`:visible`, `nth-match`, or a further-attribute qualifier). Without it, mechanical transcription re-introduces the hidden-duplicate `boundingBox` hang the runbook's "Locator gotchas" block documents. Browxai's driving skill (`harness/driving-browxai/SKILL.md`) carries the workaround agents apply manually in the meantime.

### 14. 🟡 `find()` scoring weight for test-attribute string matches

Exact testid in the query failed to surface a matching `<input>` element because role+name surface was empty (no `aria-label`). Three options on browxai's side: score testId hits independently of role/name, boost `role == "input"` + testid-keyword match, or signal "no confident candidate" so the agent falls through to reading the testid off the snapshot row. Highest-leverage re-adoption ask — it's the gap between "find() ranked what I asked for" and "I read the testid off the snapshot row manually."

### 15. 🟢 CDP-attached bbox

`find().bbox` returns `null + clipped: true` for plainly-visible elements on the BYOB path even though managed-mode bbox is byte-correct. Likely the attached context has no default viewport — set one in `src/session/byob.ts`, or read it off `Page.viewportSize()`. Doesn't block calibration (bbox is "evidence" not "locator"); promote to load-bearing if any agent surface starts depending on it.

### 16. 🟢 Docs nit: `stability` semantics + `find()`-matching surface

"high stability" means "snapshot disambiguator," not "survives deploys." Content-keyed IDs (e.g. `[data-testid="example-content-12345"]` — the asset ID changes daily) come back with `stability: "high"` even though they're brittle for a long-lived flow file; the calibration agent has to recognise and rewrite to a `^=` + `:has-text(...)` pattern. Plus: `find()` matches against `name` + `role` + test-attribute values — icon-only tabs whose `title="…"` carries the only signal don't match keyword queries. Either docs-only in browxai's `tool-reference.md` / driving skill, or a small `stabilityKind: "structural" | "content-keyed"` heuristic field.

---

## Post-contract wave from browxai (no asks; site-docs benefits)

After the contract closed on 2026-05-15, browxai continued shipping its own post-contract work without an asks list from site-docs. Site-docs benefits directly from these — the runbook + calibrate skill now reference them as the recommended path. Full descriptions in **`<browxai>/harness/driving-browxai/SKILL.md`** + **`<browxai>/docs/tool-reference.md`**; summarised here so future readers see the chronology:

- **`browxai init <workspace>`** — bootstraps a per-consumer workspace dir, writes a workspace-scope `.mcp.json` with both managed + BYOB MCP entries, sniffs the codebase for the dominant test-attribute convention. Replaces the manual `claude mcp add-json` dual-registration recipe in earlier versions of site-docs's runbook.
- **`browxai chrome [start|stop|status]`** — owns the `--cdp` Chrome lifecycle. Persistent profile at `$BROWX_WORKSPACE/chrome-profile/`; `--insecure` opts into `--disable-web-security`. Replaces the manual `chrome --remote-debugging-port=9222 …` recipe.
- **`browxai doctor`** — environment + connectivity health-check (build / workspace / test-attrs / cdp / chromium / capabilities / confirm-hooks / origins). One-line fixes per ✗.
- **`start_recording` / `end_recording` / `record_annotate`** — record a calibration walk; emit a draft site-docs flow-file YAML. Replaces the inspect → hand-write loop for the happy case.
- **`name_ref` / `list_named_refs`** — bind a mnemonic to a ref; subsequent action calls accept `named: "<name>"` instead of re-finding the element.
- **`find_feedback({ query, ref })`** — session-scoped learned ranking. Tell browxai which candidate was right; subsequent finds with overlapping tokens get a boost.
- **`eval_js({ expr })`** — escape-hatch JS evaluation. **Off by default** (the `eval` capability isn't in `DEFAULT_CAPABILITIES`); return value is treated as untrusted page content.
- **Capability / allowlist / confirm-hook layer** — `BROWX_CAPABILITIES` (default `read,navigation,action,human`), `BROWX_ALLOWED_ORIGINS` (comma-separated, wildcards supported), `BROWX_BLOCKED_ORIGINS`, `BROWX_CONFIRM_REQUIRED` (policy hooks that route through `await_human` first). Threat model documented at `<browxai>/docs/threat-model.md`. Site-docs's discovery / calibration workflows don't need to enable any non-default capability for ordinary runs.

No new asks here — site-docs reaps the benefits. The next contract round opens if/when site-docs hits a real friction point browxai's surface doesn't cover.

---

## Deferred work — status at the v0.7.0 re-pin (2026-06-12)

Most of the 2026-05-15 deferred list shipped in browxai v0.3–v0.7:

- ✅ `dump_storage_state` / `inject_storage_state` + the `auth_save`/`auth_load`/`auth_list`/`auth_delete` family — shipped.
- ✅ `network_read` as a standalone surface — shipped (plus `network_body`, `start_har`/`stop_har`).
- ✅ `await_human` kinds beyond `acknowledge` — shipped (incl. `choose_option`, `approve_actions`).
- ✅ `browxai doctor` + `browxai init` + `browxai chrome` lifecycle — shipped.
- ✅ Recording: `start_recording` / `end_recording` / `record_annotate` + `export_playwright_script` — shipped.
- Still open browxai-side (re-verify before relying): `find().selectorHint` tiers 3/4; `snapshotDelta.scope` / `tree_diff`; auto-default `BROWX_ATTACH_CDP`; the no-trace CI test; headless-under-CI exercise.
- Replacing **execution** mode's Playwright with browxai. Execution stays deterministic, no agent, no MCP. browxai is discovery/calibration only.

---

## Contract round 3 — re-pinned to browxai v0.7.0 (2026-06-12)

The 2026-05-27 Phase-2 re-validation pinned this contract to browxai **v0.2.0**. browxai has since cut v0.3.0 → **v0.7.0** (2026-06-08; ~200 tools across 17 capabilities, the v1 plugin runtime, canvas substrate, perf module, diagnostics, typed SDK). v0.7.0 is declared the final v0.x; v1.0 lands with browxai's public flip. This round records the re-pin; the operational reference is browxai's `harness/driving-browxai/SKILL.md` + `docs/tool-reference.md`.

### Ask status updates

- **#12 (`wait_for.timeoutMs` 120 s cap) — superseded.** browxai's timeout ceiling is now 1 hour. Confirm on the next live calibration, then close.
- **#13–#16 — needs-retest against v0.7.0.** No CHANGELOG evidence they landed as asked; `find()` ranking and snapshot shapes changed substantially since v0.2.0 (DOM-walk merge, `find_feedback`, frame scoping). Retest on the next adoption run; refile anything still open as `diagnostics_note({ category: "missing-primitive" })` evidence (see below) rather than anecdote.

### New composition opportunities (calibration-side; execution stays browxai-free)

Worth folding into the calibrate skill / runbook as the recommended path — never duplicated in the engine:

- **`flake_check`** (n-run variance with `stopOnAllGreen` + `cachedResolvers` self-heal artifacts) — pre-commit determinism validation of a candidate step sequence before it's translated into a flow-file.
- **`watch({ durationMs })`** — observe transient/conditional UI to justify `optional: true` steps with evidence.
- **`screenshot({ path })`** (file-io capability) — per-step capture to disk instead of base64 into agent context.
- **`clock` / `seed_random`** — date/randomness-stable pages during calibration walkthroughs. **BYOB residue warning:** these persist on an attached Chrome after detach — reset before ending a session. (Execution-side equivalents are engine-native: the flow-file `environment` block.)
- **`overflow_detect`** — pre-screenshot layout sanity sweep (clipped/ellipsis findings = bad doc screenshots).
- **`generate_locator` / `extract(schema)`** — locator authoring + structured page reads during calibration (recorded 2026-05-27 as follow-ups; now available).
- **`end_recording` + `export_playwright_script`** — record a walk, emit a draft flow-file + a Playwright spec; the spec's `fragile`-selector markers double as the locator-review checklist. docsxai's `docsxai export playwright` is the inverse (flow-file → spec) — the two are complementary, not duplicative.
- **`diagnostics_note` / `diagnostics_report`** — the asks pipeline itself: file friction during calibration runs with the `diagnostics` capability enabled; `missingPrimitiveHypotheses` becomes the evidence section of round 4.
- **`plugins_list` / canvas substrate** — discover canvas-app adapter plugins at calibration boot; canvas targets compose `canvas_capture` → agent vision (BYO-vision) → `canvas_query`/`gesture_chain`.

### Constraints to respect

- **BYOB refusals:** `pdf_save` and video recording are refused on attached (BYOB) sessions — docsxai's canonical calibration mode. Anything PDF/video runs execution-side through the engine's own Playwright sessions.
- **Semver horizon:** everything docsxai composes behind off-by-default capabilities (`file-io`, `diagnostics`, `canvas`, `eval`) is explicitly outside browxai's pre-1.0 stability guarantee. Calibration-skill compositions are recommendations, not hard dependencies; re-verify at browxai v1.0.
- **The split is unchanged:** browxai owns discovery; `docsxai run` stays raw Playwright forever; the docsxai MCP server exposes calibration meta-orchestration + doc-pack introspection only and must never re-expose browxai primitives.
