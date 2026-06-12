# Agent guidance — reach for this, not that

> docsxai's footgun map for calibration agents. Every entry is a temptation an agent reliably
> meets, why giving in bites later, and the right call with a copyable example. The engine's
> design pushes the same direction everywhere: **write-time signal beats run-time control, and
> declared intent beats clever workarounds.** When you are about to work around the engine,
> check this list first — the workaround usually has a first-class primitive.

The one-line map:

| Temptation                                                  | Reach for instead                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| A permissive comma-selector for UI that sometimes appears   | `optional: true` on the step                                             |
| Running the flow to see if it works                         | `docsxai lint` first — write-time signal beats run-time halt             |
| Re-walking a long flow to test one new step                 | `run --flow <name> --start-from <step> --cdp <endpoint>`                 |
| Selector fallback lists                                     | One canonical locator; a halt is drift, recalibrate                      |
| Fudging screenshots that differ per run                     | Pin the `environment` block (clock, locale, timezone, viewport)          |
| Editing PNGs to hide sensitive UI                           | `redactions` in the flow-file                                            |
| Hand-rolled HTTP push to a wiki                             | A publisher plugin + an `egress:<host>` capability grant                 |
| Writing artifacts via absolute paths                        | Workspace-rooted IO only — path escapes throw                            |
| Raw JS eval against the live page during calibration        | browxai's curated `find()` / `snapshot()` surface                        |
| Retrying a halted run                                       | `docsxai diagnose`, edit the flow, then `run --start-from`               |

## Conditional UI: `optional: true`, not permissive selectors

**The temptation.** A confirm modal appears only sometimes. A comma-selector that matches
"either the OK button or something harmless" makes the step pass on both branches:

```yaml
# DON'T — clicking the title is a semantic no-op that can mis-fire if it has a handler
- id: dismiss-confirm
  action: click
  target: 'button:has-text("OK"):visible, [data-type="title"]:visible'
```

**Why it bites.** The selector lies about intent. On the no-modal branch the step clicks
something unrelated; if that element ever gains a handler, the flow mutates app state. Lint
can't help you because the step looks structurally fine.

**The right call.** Conditionality is declared on the step, not hacked into the selector:

```yaml
- id: dismiss-confirm
  action: click
  target: $confirm_ok
  optional: true # skip-and-continue if the action/wait/success throws
  wait_for: { selector: $confirm_ok }
```

A skipped optional step logs to stderr and emits no screenshot. Keep a `wait_for` or `success`
guard on it — an unguarded `optional` swallows real regressions (lint R008).

## Lint before run

**The temptation.** The flow looks right; run it and see.

**Why it bites.** A run costs a browser launch and minutes of walking; on a long flow you find
one mistake per run. Ten authoring mistakes cost ten runs — `lint` reports all ten in
milliseconds, before any browser exists.

**The right call.**

```bash
docsxai lint "$WORKSPACE" && docsxai run "$WORKSPACE" --flow <name>
```

`lint` is pure-static and exits 1 on any warning: deep `extends` chains, annotations anchored
to unmounting targets, missing `timeout_ms` on long-async steps, hidden-duplicate-prone bare
`[data-*=…]` selectors, unguarded optional steps, and more (R001–R010). `docsxai flow-tree`
does the same for the `extends` graph.

## The `--start-from --cdp` inner loop, not full re-walks

**The temptation.** You edited step 9 of a flow whose step 4 waits on a two-minute backend
job. Re-run the whole flow to validate the edit.

**Why it bites.** Every iteration costs the full walk — the two-minute wait included. Ten
iterations on the tail step cost twenty-plus minutes of pure re-walking.

**The right call.** Keep a browser in the post-step-8 state (a `--pause`d previous run, or
your `capture-auth --cdp` Chrome) and validate only the new step against it:

```bash
docsxai run "$WORKSPACE" --flow <name> --start-from <step-id> --cdp http://localhost:9222
```

Every step before `<step-id>` is skipped; the new step's annotations merge into the existing
`annotations.json` by step id, prior artifacts stay intact. Related: factor shared preambles
into an un-annotated parent flow (`extends: preamble`), and use
`run --stop-after <step-id> --pause` to park a browser mid-flow.

## One canonical locator; drift is a signal

**The temptation.** The selector broke once, so make it resilient:
`locators: { save: '#save, [data-testid="save"], button:has-text("Save")' }`.

**Why it bites.** Fallback lists hide drift. When the app changes, the selector silently
shifts to a different element and the docs keep rendering — wrong. The engine deliberately
refuses fallback lists in `locators` for exactly this reason; a selector that needs a fallback
is a selector that needs fixing.

**The right call.** One selector per name, the most stable the page offers (test attribute,
role, text). When it breaks, the run halts with a `[cause: …]` prefix — that halt is the
feature. Recalibrate the one locator instead of armouring it:

```yaml
locators:
  save_button: '[data-testid="save"]:visible' # one canonical selector, no fallbacks
```

`docsxai diff` watches `locators.yaml` churn, so locator changes show up in drift reports
instead of slipping through.

## Pin `environment`, don't fudge screenshots

**The temptation.** Screenshots differ between runs — a clock in the header, a locale-shaped
date — so you re-crop, re-shoot at the right moment, or accept noisy diffs.

**Why it bites.** Every post-hoc fix is manual work on a generated artifact, redone every
refresh, and pixel-diff gating (`docsxai diff --fail-on warn`) drowns in false positives.

**The right call.** Determinism is declared in the flow:

```yaml
environment:
  clock: "2030-01-02T03:04:05Z" # every Date/now() in the page returns this
  locale: en-GB
  timezone: Europe/Amsterdam
  viewport: desktop
  color_scheme: light
```

Same flow + same target state → byte-identical screenshots, keystone-enforced. On CDP-attached
runs only the clock applies (the engine warns once listing skipped fields).

## `redactions` in the flow, not edited PNGs

**The temptation.** An API key or customer email is visible in a capture — open the PNG and
black it out.

**Why it bites.** The edit is destroyed by the next run, halt screenshots leak the same value
unedited, and a hand-touched PNG breaks byte-identical reproducibility.

**The right call.** Declare the mask; the engine applies it before any pixel hits disk, halt
shots included, with deterministic fills:

```yaml
redactions:
  - { selector: $api_key_field } # solid box over the element's bbox
  - { selector: $billing_total, style: pixelate } # 16-px mosaic
  - { region: { x: 10, y: 80, width: 220, height: 40 } } # fixed CSS-px rect
```

## Publishers via the plugin runtime, not hand-rolled HTTP

**The temptation.** Pushing the doc pack to Confluence is one `fetch` call away — script it.

**Why it bites.** A hand-rolled push lives outside the engine's egress discipline: no
capability declaration to review, credentials handled ad hoc, no idempotency, and the next
operator can't discover it. The engine core deliberately emits files and payloads only;
publisher plugins are its only wiki/VCS egress path.

**The right call.** Use (or write) a publisher plugin and grant the capability explicitly in
the workspace:

```json
{
  "plugins": [{ "package": "@docsxai/plugin-confluence" }],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

Then `docsxai plugins sync` (pin the lock) and invoke `confluence:push` — idempotent by
content-sha. For agent-supervised publishing without any plugin, `docsxai export adf` writes
the projection for the Atlassian MCP and the engine never holds wiki credentials at all.

## Workspace-rooted IO only

**The temptation.** Write a helper artifact to `/tmp`, or reference a screenshot by absolute
path because it was convenient.

**Why it bites.** Everything that consumes a doc pack — `zip`, `push`, `diff`, the viewer,
plugins — assumes the pack is self-contained under the workspace root. Absolute paths leak
machine-local layout into shareable artifacts and break the no-trace contract with the target
app's repo.

**The right call.** All engine IO routes through `resolveWorkspacePath`, which throws on
absolute paths and `..` traversal; plugin code gets the same guarantee through
`api.workspacePath(...)`:

```ts
const out = api.workspacePath(".export", "report.json"); // inside the workspace, checked
```

If you are an agent writing files around the engine, follow the same rule: everything lands
under `$WORKSPACE`, nothing inside the target app's checkout.

## Calibrate through browxai's curated surface, not raw page eval

**The temptation.** During calibration you control a browser — `eval` a snippet against the
page to find elements or read state.

**Why it bites.** Raw eval output doesn't transcribe into flow-files: you get answers without
locator hints, stability ratings, or actionability states, and you've stepped outside the
trust posture (the suite never executes page-supplied JS in a privileged context; keep
agent-supplied JS to the same standard). The result is selectors that look fine in the eval
and halt in replay.

**The right call.** browxai's `find()` returns ranked candidates with `selectorHint`,
`stability`, and bounding boxes; `snapshot()` gives the merged a11y + DOM view;
`actionable()` tells you before you commit a step whether the selector is clickable, covered,
or duplicated ([the actionability contract](actionability-contract.md)). Those outputs
transcribe mechanically into flow-file locators — which is the point. For authed-page
inspection without browxai, `docsxai inspect` does the storageState bridge for you.

## `diagnose` after a halt, never blind retries

**The temptation.** The run halted; run it again and hope.

**Why it bites.** Halts are deterministic drift, not flakes — the engine has no
retry-until-green and no selector fallbacks, so the second run halts identically. Blind
retries burn minutes and tell you nothing.

**The right call.** Read the `[cause: …]` prefix, then gather the typed context:

```bash
docsxai diagnose "$WORKSPACE" --flow <name> --step <step-id> --cdp http://localhost:9222 --format json
```

It packages the step's selector / `wait_for` / `success`, the halt screenshot path, a live
`actionable()` probe, and typed recommendations (`selector` / `wait_for` / `success` /
`annotation_target` / `split_step` / `investigate`). Apply the edit yourself — the engine
never auto-patches a flow-file — then validate in seconds with
`run --start-from <step-id> --cdp`. The full loop is in the
[agent runbook](agent-runbook.md).
