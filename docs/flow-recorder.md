# Flow recorder

Design for roadmap item 5. Status: proposed, not built.

## Problem

Writing the first flow is the slowest step of adopting docsxai. Today an agent writes it from a prompt through the Claude Code plugin, or a person writes the YAML by hand. Click-recorder tools such as Scribe and Tango win the first ten minutes because a person only has to click through the task once. docsxai should match that first-use effort and keep what makes it different: the result is a flow file in the repo that replays to the same bytes.

## Proposal

A recorder drives the app once in a headed browser, watches the person click and type, and writes a flow file. The person (or an agent) then adds captions and annotations and runs the normal commands.

1. **Capture.** Launch Chromium headed with the workspace's auth and environment (clock, locale, timezone, viewport), so the recording sees the same page the replay will. Listen for navigation, click, input, select, key and file-chooser events in the page.
2. **Choose a locator for every event.** In this order: a test id attribute, then role and accessible name, then visible text, then a short CSS path. A positional selector (nth-child, a generated class name) is never written. When nothing stable exists, the step is written with a `# needs a stable locator` comment, so the gap is visible in the file.
3. **Name locators.** Each distinct target becomes an entry under `locators` and steps refer to it with `$name`, the form the flow file already uses. Names come from the accessible name or text (`$invite_button`), with a numeric suffix on a clash.
4. **Write steps.** One step per meaningful event, with an id from the action and target. Typing collapses to one `fill` with the final value. Values that look like secrets (password inputs, tokens) are never written as literals. The step gets an empty value and a comment saying to supply one. A `wait` with `network_idle` goes in after a navigation that triggers requests.
5. **Verify before accepting.** The recorder replays the new flow twice and runs the determinism comparison. A flow that does not replay to the same bytes is written anyway, flagged, with the report's next-step line, so the author knows what to pin.

What the recorder does not do: write captions, annotations, `success` criteria or redactions. Those are judgement calls and stay with the author or the agent. The agent's job shrinks from "discover the app" to "describe what the recording shows".

## Where it lives

Two choices.

- **In the engine as a new command.** Simplest for users (one install). The engine already owns the Playwright driver and the flow-file writer. Adds a command to the public surface, which needs a surface row and a usage-text entry.
- **As an import from a browxai session.** browxai already records sessions and exports a Playwright script. A converter from that export to a flow file needs no recorder code in docsxai, but makes browxai a dependency of the first run.

Recommendation: the engine command, with the event-to-step mapping as a pure function so a browxai importer can reuse it later.

## Open decisions

- Command name and flags. Parked until the engine route is confirmed.
- Whether recorded values may be literals when the app is a local demo with no real data. Safest default: literals only after the author confirms.
- How much to clean up automatically: merging two `fill` events on one field is safe, dropping an accidental click is a guess.

## Build steps

1. A pure mapper from a list of captured events to flow steps and locators, with unit tests over fixture events. No browser.
2. The locator chooser, tested against fixture DOM snapshots in the existing real-Chromium keystone suite.
3. The capture layer: headed launch, event listeners, stop on a key or on window close.
4. The command, the usage text, the surface row, docs and the changelog.

Steps 1 and 2 ship first and are small pull requests. Step 3 needs a real browser and a review of what the page-side listeners can leak into the run, so it gets its own security pass (workspace IO and outbound HTTP are untouched, but the recording sees whatever is on screen).

## Not in scope

- Recording video or audio.
- A visual editor for flows. The flow file in git is the point.
- Self-healing locators at replay time. A broken locator halts the run, as it does today.
