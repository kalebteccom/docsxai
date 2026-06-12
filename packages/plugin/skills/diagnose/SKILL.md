---
name: docsxai-diagnose
description: Use when a deterministic `docsxai run` halts on a locator or success-criterion failure (drift). Gather halt context, propose a minimal recalibration diff for the affected flow-file, validate the fix in seconds via `--start-from --cdp`. Never patch silently or add selector fallbacks.
---

# Diagnosing a halted run

A halted run means the site drifted from what the flow-file encodes — that's a _signal_, not a flake to absorb. The diagnose loop is explicit and agent-driven; the engine never auto-patches the flow-file.

## 1. Run the diagnose command

```bash
docsxai diagnose <workspace> --flow <name> --step <step-id> [--cdp <endpoint>] [--format json]
```

This gathers:

- The current step's selector (resolved if it's a `$ref`), `wait_for`, `success`
- The most recent halt screenshot at `docs/<flow>/halts/<step>.png` if one exists
- **With `--cdp`:** a live probe — connects to the running Chrome, runs the engine's `BrowserDriver.actionable()` predicate on the target selector, captures current URL + bbox
- Recommendations: one of `selector` / `wait_for` / `success` / `annotation_target` / `split_step` / `investigate` — each with a rationale and a concrete suggestion

`--format json` is the agent-facing path; the report has a stable shape (`DiagnoseReport` in `packages/engine/src/diagnose.ts`).

## 2. Read the recommendations + decide

The recommendation taxonomy maps to common drift shapes — see [`docs/actionability-contract.md`](../../../../docs/actionability-contract.md) for the underlying state vocabulary.

| recommendation                                                       | typical fix                                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selector` (e.g. live probe = `not-found` / `multiple-matches`)      | Re-discover the element via browxai's `find()` / `docsxai inspect`; commit a new canonical locator (or scope the existing one with `:visible` / `:nth-match`). |
| `wait_for` (`not-visible` after a long-async action)                 | Add or strengthen `wait_for: { selector: <sel>, timeout_ms: <ms> }`.                                                                                           |
| `annotation_target` (`detached` — the action target unmounted)       | Set `annotation.target` to a surviving element in the resulting state. The action's `target` stays the same.                                                   |
| `split_step` (`off-screen` / `covered`)                              | Insert a step before the action — scroll-into-view, dismiss-overlay, ESC-key.                                                                                  |
| `success` (the `success` clause looks fragile, e.g. `text_contains`) | Replace with a structural criterion where stable; or update the expected text.                                                                                 |
| `investigate` (live probe = `actionable` / `disabled`)               | Race / flakiness in the original run; or a product-state decision (`disabled` may be intentional). Don't auto-edit.                                            |

If the change is non-obvious, surface the candidates to the user. **Never silently pick** between locator alternatives — drift signals must remain visible.

## 3. Edit the flow-file

Hand-edit `flows/<flow>.flow.yaml`. One canonical locator per step; no fallback lists.

If the drift is structural (steps added/removed by the app, not just a selector renamed), recommend a fuller `/docsxai:calibrate` of that flow instead of patching — the agent / human's call.

## 4. Validate the fix in seconds

```bash
docsxai run <workspace> --flow <name> --start-from <step-id> --cdp <endpoint>
```

`--start-from` skips every step before the fixed one; `--cdp` attaches to the same Chrome the diagnose probe used (so the page state from the prior steps is already there). The new annotation merges into the existing `annotations.json` by step id — prior steps' annotations and screenshots stay intact. If the step now runs clean, the fix is good; if it halts again, re-run `diagnose`.

Then offer to re-`render` to refresh the viewer.

## Anti-patterns

- **Don't add selector fallbacks** (`locators: { play_btn: ['#play', '.play-btn', '[data-foo=play]'] }`). One canonical locator per step. Drift through a fallback list is invisible drift — that's worse than a halt.
- **Don't absorb intermittent timing as "drift"** — that's flakiness. Address with async primitives (`wait_for: network_idle` / `element_stable` / `timeout_ms`), documented inline in the flow-file.
- **Don't run `docsxai run` blindly to "see what happens"** — the diagnose probe + `--start-from --cdp` is the fast loop. Blind re-runs cost minutes per iteration on long-async flows.
