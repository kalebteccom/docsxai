---
title: Troubleshooting
description: How to read a halt, the halt-cause vocabulary, the diagnose-edit-rerun loop, expired sessions, locator gotchas, wait tuning, and the lint rules that prevent most of it.
---

The first thing to internalise: **a halt is drift, not a flake**. The engine
deliberately has no selector fallbacks and no retry-until-green - when a
locator or success criterion fails, the run halts so you fix the flow-file or
acknowledge the app changed. Do not retry blindly; read the cause, diagnose,
edit, re-run.

:::caution[For agents]
Halts are deterministic: the same flow against the same target state halts
identically, so a second run tells you nothing new. Spend the next action on
`docsxai diagnose`, not on a retry. The full temptation list lives in the
[agent guidance](/guides/agent-guidance/).
:::

## Reading a halt

A halted step's error message starts with a `[cause: ...]` prefix inferred
from Playwright's actionability log, and a screenshot of the moment lands at
`docs/<flow>/halts/<step>.png` (the path is in the message). Read the cause
first; open the screenshot to confirm. The vocabulary:

| Halt cause prefix                                                            | What it means                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `[target is disabled]` / `[target is not enabled]`                           | The element is there but rejects interaction (disabled / aria-disabled).               |
| `[target is not visible (display:none / visibility:hidden / zero-sized)]`    | CSS-hidden at action time.                                                             |
| `[target was detached from the DOM (likely unmounted by an earlier action)]` | A prior step's action removed it.                                                      |
| `[target is outside the visible viewport]`                                   | Visible CSS-wise but fully off-screen and not auto-scrollable.                         |
| `[target is animating / not yet stable]`                                     | The element's box was still moving when the action fired.                              |
| `[target is covered by another element]`                                     | Something else receives the click (a modal, a toast, an overlay).                      |
| `[selector matched multiple elements (strict-mode violation) ...]`           | The selector resolves to more than one node - usually a hidden duplicate.              |
| `[timeout waiting for selector ...]`                                         | A `wait_for: { selector }` never appeared - raise `timeout_ms` or revisit the locator. |

These are the same states the write-time `actionable()` probe returns
(`disabled`, `not-visible`, `detached`, `off-screen`, `covered`,
`multiple-matches`, `not-found`), so a pre-action probe and a run-time halt
speak one vocabulary - the
[actionability contract](/reference/actionability/) maps them one to one.

## The diagnose loop

```sh
docsxai diagnose <workspace> --flow <name> --step <step-id> --cdp http://localhost:9222
```

`diagnose` packages the step's selector, `wait_for`, `success`, the halt
screenshot path, and - with `--cdp` - a live `actionable()` probe of the
target on the running page, then prints typed recommendations: `selector`,
`wait_for`, `success`, `annotation_target`, `split_step`, or `investigate`.
`--format json` makes the output machine-readable for an agent. The engine
never patches the flow-file itself; applying the fix is your (or your
agent's) explicit move.

Then validate the fix in seconds instead of re-walking the whole flow:

```sh
docsxai run <workspace> --flow <name> --start-from <step-id> --cdp http://localhost:9222
```

This skips every step before `<step-id>` and runs against the
already-in-state Chrome (one left open by `run --pause`, or your
`capture-auth --cdp` browser). New annotations merge into the existing
`annotations.json` by step id; prior steps' artifacts stay intact.

## Session expired

If `run` reports that no valid cached session exists (or the app bounces to
its login page mid-flow), the cached auth session lapsed. Re-capture:

```sh
docsxai capture-auth <workspace>
```

The persistent Chrome profile under `.auth/chrome-profile/` usually still
holds the login, so re-capturing is just triggering
`window.__docsxai.capture()` again. If expiry keeps surprising you, pin the
app's real session cookie (`--auth-cookie <name>`) so the cache tracks its
actual expiry instead of the `ttl` guess - and for unattended CI, switch to a
scripted strategy from the [auth catalogue](/reference/auth-strategies/).

## Locator gotchas

- **Hidden duplicates.** A bare `[data-foo="x"]` can match a visible element
  plus a hidden phantom; strict mode then picks wrong or throws
  `multiple-matches`. Scope with `:visible`
  (`[data-foo="x"]:visible`) or use a role/text selector.
- **Annotations on vanishing targets.** When a step's action transitions the
  UI, the action target unmounts and the halo has nothing to anchor to. Give
  the annotation a `target` override pointing at an element that exists in
  the resulting state:
  `annotation: { copy: "...", target: $appearing_element }`.
- **Conditionally-present UI.** A confirm modal that sometimes appears, a
  first-run tooltip, a cookie banner: mark the step `optional: true` instead
  of crafting a permissive comma-selector that no-ops on one branch. A
  skipped optional step logs to stderr and emits no screenshot.
- **Content-keyed test ids.** An id like `data-testid="report-card-8841"`
  changes with the data. Rewrite to a prefix match plus text qualifier
  (`[data-testid^="report-card-"]:has-text("June")`) before it goes into a
  flow-file.

## Tuning waits

- **Slow backend operations.** The default selector wait is about 30
  seconds. For a step that waits on a multi-minute job, override it per step:
  `wait_for: { selector: $done_marker, timeout_ms: 180000 }`.
- **`element_stable`.** On a step with a `target`, this polls the element's
  bounding box every 100 ms until two consecutive reads agree (within half a
  pixel), with a 10-second best-effort budget - a perpetually animating
  element proceeds after the budget rather than wedging the run. Without a
  `target` it waits on nothing; lint flags that.
- **Blind sleeps.** `wait_for: { timeout_ms: N }` alone is a last resort for
  animations, not state. Prefer a selector wait or `network_idle`.

## Lint as prevention

`docsxai lint <workspace>` runs pure-static checks before any browser
launches; exit 1 on any warning or error. The rules:

| Rule | Severity | Catches                                                                                                      |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------ |
| R001 | info     | An `extends` chain four or more flows deep - flatten it.                                                     |
| R002 | warning  | An annotation anchored to a likely-unmounting click/navigate target with no `target` override.               |
| R003 | warning  | A selector `wait_for` with no `timeout_ms` on a long-async-looking step.                                     |
| R004 | info     | A bare `[data-*="..."]` selector that may hit hidden duplicates - scope with `:visible` or `:has-text(...)`. |
| R005 | error    | An `extends` target that does not exist in the workspace.                                                    |
| R006 | info     | A locator defined but never referenced by any step, wait, success, annotation, or redaction.                 |
| R007 | warning  | A terminal step with no `success` criterion - the run can end unverified.                                    |
| R008 | warning  | An `optional: true` step with no `wait_for` or `success` guard - real regressions get silently swallowed.    |
| R009 | warning  | `wait_for: element_stable` on a step with no `target` - it waits on nothing.                                 |
| R010 | warning  | An annotation anchored to an element a redaction masks - the callout would point at a black box.             |

Plugins can contribute additional rules; see
[Writing plugins](/guides/writing-plugins/). For the full calibration
iteration playbook - shared preambles via `extends`, `--stop-after --pause`,
parallel flows - read the [agent runbook](/guides/agent-runbook/).
