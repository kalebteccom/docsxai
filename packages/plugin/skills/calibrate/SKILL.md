---
name: site-docs-calibrate
description: Use to produce or refresh a site-docs doc pack for a feature area. Drives the calibration pipeline — discovery → mapping+testing → commit — turning a written flow description (a structured .md flow-guide or loose prose) plus a running target URL into flow-files, screenshots, annotations, a style artifact, and a locator manifest. You (the agent) supply all inference; the engine never calls a model API.
---

# Calibrating a doc pack

Inputs you'll be given (as arguments / asked for): a target URL of the *running* app, a `.md` flow description (structured flow-guide or loose prose), optionally a style-seed source (an existing doc, e.g. a Confluence page), and a project directory to write into.

The pipeline has three stages. Each is a typed engine function returning a structured result; when the engine can't proceed it returns `{ status: "needs_resolution", ambiguity, resumeToken }` — you resolve it (pick a candidate, supply a selector, provide a value, confirm, skip, or abort) and call `resume(resumeToken, resolution)`. One ambiguity = one of your turns. Persist intermediate state as you go.

## 1. Discovery — walk the live site

Drive the operator's live browser through a **host-agent-drivable browser API over MCP** (the BYOB pattern: the engineer is already authenticated to the target site there — never ask for credentials, never put credentials anywhere). The canonical, model-agnostic driver is **[browxai](https://github.com/kalebteccom/browxai)** — Kalebtec's MCP-native browser bridge. Phase 1 + a same-day Phase-1.5 pass (post-the target app-adoption-run 2026-05-13) have shipped. Setup uses a **dual MCP registration** — `browxai` (managed; default) and `browxai-attached` (BYOB; `BROWX_ATTACH_CDP=http://127.0.0.1:9222`); for site-docs runs against an authed target, pick `browxai-attached` once `site-docs capture-auth --cdp` has the Chrome up. Set `BROWX_TEST_ATTRIBUTES` in the env block to declare the target codebase's test-attribute convention (comma-separated, order-sensitive, first match wins; default `data-testid,data-test,data-cy,data-qa` — extend with the project's own attr if needed, e.g. the target app: `data-testid,data-type,data-test,data-cy,data-qa`). The host agent gets `find(query)` (ranked candidate locators with `selectorHint` + `stability: high|medium|low` + visible-rect bbox + evidence; tier-1 doesn't gate on a `role` wrapper — `<div data-type="x">` gets `stability: "high"` directly), `snapshot()` (a11y tree **augmented with a DOM walk** that picks up interactive elements + test-attr bearers, merged with `[from-dom]` / `[from-both]` source markers and a `warnings:` header block when the a11y tree was sparse), persistent refs within a session, action primitives that report what changed, `await_human({kind:"acknowledge"})` checkpoints, plus screenshots / console / network reads. Full integration contract (11 asks: 7 ✅, 3 🟡, 1 📅; Phase-1.5/Phase-2 deferrals named) at `docs/browxai-asks.md` in the engine repo. Fallbacks if browxai misbehaves on a specific page: **`site-docs inspect "$WORKSPACE" --cdp <endpoint>`** or driving the same `--cdp` Chrome with Playwright directly (`chromium.connectOverCDP(...)`). *Legacy:* Anthropic's **Claude in Chrome** extension (`mcp__claude-in-chrome__*`) is still a valid driver in a Claude-Code-driven session, but it's Claude-locked and isn't the canonical path. For each flow in the description:

- Reproduce the steps in the live page; for each step, find the element the prose refers to.
- **Expect under-specification** — real flow descriptions are looser than the elements you'll find. When a step is ambiguous (multiple plausible elements, or the prose doesn't pin one), let the engine surface it and resolve it *with the user* (show the candidates + your evidence) rather than guessing. Under-specification is the norm, not the edge case.
- Capture: the page structure, candidate locators (prefer role/text/test-id over brittle CSS), the bounding box of the target, and a clean screenshot per step (no baked annotations).

Output of discovery: candidate flow steps + locators + screenshots, with ambiguities resolved.

## 2. Mapping + testing — pin locators, verify the flow runs

- Settle on **one canonical locator per step** — no fallback lists. If you can't pick one confidently, surface candidates.
- Add async primitives where the live walk showed instability: `wait_for: network_idle` / `wait_for: element_stable` / explicit timeouts — document known flakiness inline in the flow-file.
- Add a `success` criterion per step (visible/hidden element, URL match, text contains) so deterministic execution can halt on drift.
- **Validate determinism:** translate the candidate flow-file to the engine's flow-file format, then have it run via `site-docs run` headlessly (no agent context) — it must reproduce the docs. If it doesn't, the flow-file isn't right yet; iterate. This is the architectural keystone — don't ship a doc pack that doesn't replay.
- Also write the **target-site auth descriptor** (`auth/strategy.yaml`) if execution-mode runs will need it. Pick the strategy from the app's auth scheme — API-direct login if there's a callable login endpoint (cheapest/most robust); a test-only login backdoor if the app provides one; otherwise, for an app whose login can't be replayed headlessly (SSO / MFA / conditional access), `manual-capture` (host-spawned instrumented Chrome → engineer logs in → console/button captures `storageState`; cached `store: local`). For `manual-capture`: when `site-docs capture-auth` runs it prints the captured cookie jar — **identify the app's real auth/session cookie** (on the app's own domain, the long-lived one — e.g. `session` / `connect.sid` / `JSESSIONID` / `.AspNetCore.Cookies` / `<AppName>Identity*` — *not* the ephemeral IdP scratch cookies an SSO login leaves) and set `roles.<role>.cache.auth_cookie: <name>` (or pass `--auth-cookie <name>`), so the cached session's expiry tracks that cookie rather than the `ttl` fallback (don't trust `min(cookie.expires)` — it ≈ now right after an SSO login).

## 3. Commit — emit user-facing docs

- Run the style-discovery step if a style seed was given (extract voice/structure/terminology/visual/localisation + **pruning rules** — categories of testing jargon to strip); persist `docs/style.yaml` (+ derived `docs/style.json`). If no seed, use sensible defaults.
- For each step, write a user-facing prose write-up to `docs/<flow>/<step>.md` using the style artifact. **Semantic reshape:** the input may be written for *testing* (`VERIFY`, `WAIT`, internal locator names, network-verification blocks) — strip all of that; end users never see testing jargon.
- Emit `docs/<flow>/annotations.json` (per step: step id, resolved selector, bounding box, the user-facing copy, arrow style) and the `docs/locators.yaml` manifest.
- If multiple flows form one feature area (e.g. the first consumer's 12 Recap flows), chain them into one coherent guide — one consolidated, scrollable document on delivery, not a page tree. When several of them share a preamble (e.g. Library → open a video → editor → some panel), factor that preamble into its own flow-file (*no `annotation`s*) and have each dependent flow start with `extends: <preamble-flow>` — the engine runs the parent's steps first, so calibrating/iterating a child is cheap and the un-annotated parent adds no doc noise; `run --stop-after <step-id>` operates on the merged step list (so it can target a parent step), and `wait_for: { selector: $x, timeout_ms: <ms> }` overrides the default ~30s selector-wait for slow backend ops.

## Persistence & delivery

Persist the doc pack to the backend (default; OAuth/`SITE_DOCS_TOKEN` auth, workspace-scoped, linear immutable revisions) or `--persist tmp` for sandbox/eval. Then build the viewer (`/site-docs:render`). For an ad-hoc client delivery (the first-consumer pattern), compose the output into the client's docs surface via the relevant MCP (e.g. Confluence MCP) with credentials they provide at hand-off — we never hold long-lived client credentials, and the engine has no Confluence dependency.

## When a calibrated flow later breaks

That's not this skill — it's `/site-docs:diagnose` (the explicit, opt-in failure path). Deterministic execution is never ambient-recalibrated.
