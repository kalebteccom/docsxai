# Actionability contract — docsxai ↔ browxai (and any other consumer)

> The state of an element from the perspective of "can a flow-step actually act on it?" — a single string returned by `BrowserDriver.actionable(selector)` in docsxai's engine. Browxai's `find()` is expected to mirror this contract on its candidate results so a calibration agent can know at _write-time_ — before the step lands in a flow-file — whether the selector is fillable / clickable / scopable, instead of finding out at run-time via a halt.
>
> docsxai's own runtime doesn't call `actionable()` on every step — Playwright's per-action actionability already throws appropriately. This contract exists so external consumers can read the same state without acting.

## The states

`actionable()` returns one of these strings. Names are deliberately short so they fit cleanly into `selectorHint`-style evidence on browxai's side. They're listed below in roughly the order a calibration agent cares about them.

| state              | meaning                                                                                                                                                                                                                                             | typical Playwright signal                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `actionable`       | Ready to act on; no caveats.                                                                                                                                                                                                                        | All checks pass.                                                                                      |
| `not-found`        | Selector matched **0** elements.                                                                                                                                                                                                                    | `locator.count() === 0`.                                                                              |
| `multiple-matches` | Selector matched **> 1** element. Strict-mode violation territory — disambiguate before using (e.g. `:visible`, `:nth-match`, an extra attribute).                                                                                                  | `locator.count() > 1`.                                                                                |
| `detached`         | Matched, but the node isn't in the document any more. Almost always means an earlier action unmounted it.                                                                                                                                           | `el.isConnected === false`.                                                                           |
| `not-visible`      | CSS-hidden: `display: none` / `visibility: hidden` / zero size.                                                                                                                                                                                     | `locator.isVisible() === false`.                                                                      |
| `off-screen`       | CSS-visible but fully outside the viewport AND not reachable via auto-scroll (an element inside an `overflow: auto` container that's just below the scroller's fold is **`actionable`**, not `off-screen` — Playwright auto-scrolls before acting). | The visible-rect bbox (intersect with `overflow != visible` ancestors AND the viewport) is `null`.    |
| `covered`          | Another element is on top, intercepting clicks at the bbox center.                                                                                                                                                                                  | `document.elementFromPoint(cx, cy)` returns an element that is neither this element nor a descendant. |
| `disabled`         | `disabled` attribute / `aria-disabled` / form-disabled.                                                                                                                                                                                             | `locator.isEnabled() === false`.                                                                      |

## Order of checks (docsxai reference implementation)

The reference order matters when an element is in more than one bad state — e.g. a hidden disabled input. The first matching state wins, so the chosen order surfaces the most actionable next step for the agent. docsxai's `PlaywrightDriver.actionable()` checks:

1. `not-found` (count === 0)
2. `multiple-matches` (count > 1)
3. `detached` (count === 1 but `!isConnected`)
4. `not-visible` (CSS-hidden — fastest to check)
5. `off-screen` (visible-rect bbox null after viewport + scroll-ancestor intersection)
6. `disabled` (form-disabled — only meaningful if the element is visible and on-screen)
7. `covered` (hit-test the bbox center; check `elementFromPoint`)
8. else → `actionable`

Mirroring this order keeps the wire-format implications consistent (`{ actionable: "disabled" }` from browxai means the same thing as a docsxai run-time halt prefixed `[target is disabled]`).

## Budget

Per call: ≤ a few hundred milliseconds total. docsxai's `actionable()` takes a `timeoutMs` (default 300 ms) that bounds the _per-check_ probe — keep it small enough that calibration-time discovery doesn't stall.

Avoid using `actionable()` in tight loops; intended pattern is "one call per candidate when an agent wants to disambiguate before writing the locator into a flow-file."

## Notes for consumers

- **`covered` is best-effort.** A center-point hit-test misses partial overlays. docsxai ignores errors from the covered check and falls through to `actionable`. Don't rely on it for correctness — rely on it for the common "modal eats the click" case.
- **`off-screen` ≠ "not actionable later."** Playwright auto-scrolls. If the consumer reports `off-screen` on a candidate the agent could still scroll to and act on, that's an agent-side decision — not a contract violation.
- **The state is a _snapshot_.** Repeatedly calling `actionable()` after each action is reasonable; relying on a cached value across an action is not.
- **`multiple-matches` is the hidden-duplicate signal.** If a `[data-foo="x"]` is `multiple-matches` and only one is visible, the calibration agent's prescribed move is to emit `[data-foo="x"]:visible` (or equivalent) into the flow-file — _not_ to silently pick one. Same fix the runbook's "Locator gotchas" block names.

## Coordinates with the existing halt-cause prefix

The runtime's halt-cause prefix (see `flow-runtime.ts: inferHaltCause`) parses Playwright actionability _errors_ into the same vocabulary at halt-time. Pre- and post-action signals should match:

| halt-cause prefix (run-time)               | `actionable()` state (write-time) |
| ------------------------------------------ | --------------------------------- |
| `[target is disabled]`                     | `disabled`                        |
| `[target is not visible …]`                | `not-visible`                     |
| `[target was detached from the DOM …]`     | `detached`                        |
| `[target is outside the visible viewport]` | `off-screen`                      |
| `[target is covered by another element]`   | `covered`                         |
| `[selector matched multiple elements …]`   | `multiple-matches`                |

When these diverge (e.g. an element's state changes between calibration and execution), the divergence itself is a useful signal — usually flakiness that should be addressed with an explicit `wait_for`.

## Stability

This contract is **v1**. Adding new states (e.g. `not-stable` for animating elements, `read-only` for fields that aren't disabled but reject input) requires a contract version bump and consumer coordination. Removing or renaming states is a breaking change. Browxai's `find()` should pass through any state strings it doesn't recognise verbatim, so docsxai can extend the vocabulary without an immediate consumer update.
