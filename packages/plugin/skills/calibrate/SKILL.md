---
name: site-docs-calibrate
description: Use to produce or refresh a site-docs doc pack for a feature area. Drives the calibration pipeline — discovery → mapping+testing → commit — turning a written flow description (a structured .md flow-guide or loose prose) plus a running target URL into flow-files, screenshots, annotations, a style artifact, and a locator manifest. You (the agent) supply all inference; the engine never calls a model API.
---

# Calibrating a doc pack

Inputs you'll be given (as arguments / asked for): a target URL of the *running* app, a `.md` flow description (structured flow-guide or loose prose), optionally a style-seed source (an existing doc, e.g. a Confluence page), and a project directory to write into.

The pipeline has three stages. Each is a typed engine function returning a structured result; when the engine can't proceed it returns `{ status: "needs_resolution", ambiguity, resumeToken }` — you resolve it (pick a candidate, supply a selector, provide a value, confirm, skip, or abort) and call `resume(resumeToken, resolution)`. One ambiguity = one of your turns. Persist intermediate state as you go.

## 1. Discovery — walk the live site

Drive the operator's live browser via the **Claude in Chrome** MCP (the BYOB pattern: the engineer is already authenticated to the target site there — never ask for credentials, never put credentials anywhere). For each flow in the description:

- Reproduce the steps in the live page; for each step, find the element the prose refers to.
- **Expect under-specification** — real flow descriptions are looser than the elements you'll find. When a step is ambiguous (multiple plausible elements, or the prose doesn't pin one), let the engine surface it and resolve it *with the user* (show the candidates + your evidence) rather than guessing. Under-specification is the norm, not the edge case.
- Capture: the page structure, candidate locators (prefer role/text/test-id over brittle CSS), the bounding box of the target, and a clean screenshot per step (no baked annotations).

Output of discovery: candidate flow steps + locators + screenshots, with ambiguities resolved.

## 2. Mapping + testing — pin locators, verify the flow runs

- Settle on **one canonical locator per step** — no fallback lists. If you can't pick one confidently, surface candidates.
- Add async primitives where the live walk showed instability: `wait_for: network_idle` / `wait_for: element_stable` / explicit timeouts — document known flakiness inline in the flow-file.
- Add a `success` criterion per step (visible/hidden element, URL match, text contains) so deterministic execution can halt on drift.
- **Validate determinism:** translate the candidate flow-file to the engine's flow-file format, then have it run via `site-docs run` headlessly (no agent context) — it must reproduce the docs. If it doesn't, the flow-file isn't right yet; iterate. This is the architectural keystone — don't ship a doc pack that doesn't replay.
- Also write the **target-site auth descriptor** (`auth/strategy.yaml`) if execution-mode runs will need it. For the the first consumer engagement that's `manual-capture` (host-spawned instrumented Chrome → engineer logs in → console/button captures `storageState`; cached `store: local`, TTL ≈ session).

## 3. Commit — emit user-facing docs

- Run the style-discovery step if a style seed was given (extract voice/structure/terminology/visual/localisation + **pruning rules** — categories of testing jargon to strip); persist `docs/style.yaml` (+ derived `docs/style.json`). If no seed, use sensible defaults.
- For each step, write a user-facing prose write-up to `docs/<flow>/<step>.md` using the style artifact. **Semantic reshape:** the input may be written for *testing* (`VERIFY`, `WAIT`, internal locator names, network-verification blocks) — strip all of that; end users never see testing jargon.
- Emit `docs/<flow>/annotations.json` (per step: step id, resolved selector, bounding box, the user-facing copy, arrow style) and the `docs/locators.yaml` manifest.
- If multiple flows form one feature area (e.g. the first consumer's 12 Recap flows), chain them into one coherent guide — one consolidated, scrollable document on delivery, not a page tree.

## Persistence & delivery

Persist the doc pack to the backend (default; OAuth/`SITE_DOCS_TOKEN` auth, workspace-scoped, linear immutable revisions) or `--persist tmp` for sandbox/eval. Then build the viewer (`/site-docs:render`). For an ad-hoc client delivery (the first-consumer pattern), compose the output into the client's docs surface via the relevant MCP (e.g. Confluence MCP) with credentials they provide at hand-off — we never hold long-lived client credentials, and the engine has no Confluence dependency.

## When a calibrated flow later breaks

That's not this skill — it's `/site-docs:diagnose` (the explicit, opt-in failure path). Deterministic execution is never ambient-recalibrated.
