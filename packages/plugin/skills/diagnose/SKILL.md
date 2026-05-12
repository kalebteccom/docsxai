---
name: site-docs-diagnose
description: Use when a deterministic `site-docs run` halts on a locator or success-criterion failure (drift). Propose a recalibration diff for the affected flow-file; never patch silently or add selector fallbacks.
---

# Diagnosing a halted run

A halted run means the site drifted from what the flow-file encodes — that's a *signal*, not a flake to absorb.

1. Read the failure: which step id, which action, which selector / success criterion failed (`FlowExecutionError` carries `stepId`).
2. Open the affected `flows/<flow>.flow.yaml` and the live site (Claude in Chrome) at the point of failure.
3. Determine what changed: a renamed/moved element (→ new canonical locator), a removed step, a changed success condition, new async behaviour needing a `wait_for`.
4. **Propose a minimal flow-file diff** to the user — one canonical locator per step, no fallback lists. If the change is non-obvious, surface candidates and ask.
5. On approval, apply the diff and run `/site-docs:run` to confirm. Then offer to re-`render`.
6. If the drift is structural (steps added/removed), recommend a fuller `/site-docs:calibrate` of that flow instead of patching.

Flakiness (intermittent timing) is *not* drift — address it with async primitives in the flow-file (`wait_for: network_idle`, `wait_for: element_stable`, explicit timeouts), documented inline.
