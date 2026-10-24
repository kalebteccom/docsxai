# UI and copy rules

Every new feature, fix and copy change follows these rules. Every agent session, builder and sub-agent reads this file before it touches UI or user-facing text.

## 1. Public and user-facing copy

- No operator or private information on any user-visible surface: environment variable names, config keys, internal ids, hostnames, ticket ids, procedures, infrastructure detail, internal tool names, confidentiality framing. Keep the legal minimum and copy that doesn't leak procedures.
- Developer-facing products keep the documented environment variables, flags and tool names a user is meant to set. Operator or maintainer-only detail never appears.
- Empty states and errors say what the user does next, never what an operator configures.
- Cut words by about 50%. Plain language, no jargon, no filler, no stacked adjectives, no heading restated in the next line, no duplicated activity text.
- Every shipped locale gets the same change. Never change the meaning of a published promise, price or legal text.
- CI checks public output for ALL_CAPS_WITH_UNDERSCORES tokens, environment variable names, internal hostnames and ticket ids.

## 2. Design system

- One spacing scale, one radius scale and one type scale per product, with shared token names.
- One component per pattern (page, sheet, section, list row, card, badge, button, code block, carousel, chip, property row). A pattern in two or more places is a shared component. Extend before extracting.
- No raw padding, margin or font classes outside the primitives. A guard in CI enforces it.
- Quality bar: Linear. Tight rows, the title first with the id as a quiet prefix, quiet property lists instead of boxed chips, compact grouped headers, empty relations collapsed into one add control.
- Sans for text. Mono only for ids, code and tabular numbers.
- One floating action at most. It never covers content and never duplicates a header action.
- Touch targets at least 44 px. Visible focus. Reduced motion respected.

## 3. Geometry, responsiveness and overflow

Checked on every screen, sheet and component.

- Centering: an icon in a button, a button in a row, a badge on an icon. A child's centre is within 1 px of its parent's centre where it is centred.
- Equal insets on the left and right. Every block in a sheet has a gutter. No block sits flush to the screen edge unless it is intentionally full bleed.
- No horizontal scroll, no clipped or covered content, no text past its container, no overlapping fixed elements.
- Widths: 320, 360, 390, 430, 768, 1024, 1280 and 1920, in portrait and landscape. Also keyboard open (the composer sits flush above it), safe areas, long strings and large text.
- Both themes and every shipped locale.
- Automate with overflow detection and bounding-box checks. Keep cheap static guards in CI.

## 4. Interaction and mobile-friendly controls

- Every pattern ships with its mobile-native control. A pattern isn't done until it works by touch.
- Carousels, galleries, lightboxes, tab strips and steppers: touch swipe with snap and rubber-band, drag, keyboard arrows, a counter or dots inside the frame, safe-area aware, one shared component. Every carousel uses it.
- Sheets, drawers, modals and popovers: swipe or drag down to dismiss, a drag handle where it applies, tap outside to close, Escape, focus trap and return, bottom placement on mobile.
- Rows that overflow horizontally (chips, tabs, filters): scrollable with snap and an edge fade, never clipped.
- Lists: swipe or long-press row actions where desktop has hover actions, pull to refresh where data refreshes, tap targets of at least 44 px.
- Forms: the right input type and autocomplete, the composer flush above the keyboard, the primary action reachable one-handed.
- Every hover-only affordance has a touch equivalent.
- Lists and rows keep the title readable on mobile. No row action truncates it.
- Onboarding and first-run paths are tested end to end with real commands in a clean environment.

## 4b. States, status lines and pending actions

- Status, helper, error and progress lines never shift layout: reserve the space before the line appears (fixed-height slot or in-container overlay). Proof: element top and height are identical across idle, pending, slow, failed and done.
- While one action is pending, conflicting actions are disabled and the inputs it uses are read-only. One pending action at a time, no double submit, state restores on failure.
- Reserve the space with a fixed-height slot, a fixed or `ch` width for a label that swaps, every label of a control stacked in one grid cell with only `visibility` toggled, or an overlay inside a box that already has its size. Never insert a line, toggle `display` on a sibling in the flow, or let a spinner add width.
- An image that can fail keeps its box with `width`, `height` and an explicit `aspect-ratio`; a broken `<img alt>` can otherwise render as one line of text.
- Mark a pending control with `aria-busy="true"` or `aria-disabled="true"` and ignore clicks on it while it is set; clear it when the action settles, success or failure, and put the label and inputs back as they were.

## 5. Proof before push

- Real screenshots at 390 and 1280 before each push, with before and after pairs for UI changes.
- One gate and one deploy per integration batch.
- Every UI or copy pull request says `ui-rules checked: yes, <what was checked>`. Reviewers reject UI or copy changes without it.

## 5b. Strings, chunks and audits

- Strings shown to users or models (error messages, tool descriptions, refusal text) never cite ticket, decision-record or other internal ids.
- Lazy-loaded chunks need a stale-build path: a dead hashed chunk after a deploy reloads once and never retries forever, and a chunk that lands late never steals focus.
- Audits and sweeps read real main with `git archive refs/remotes/origin/main` after a fetch, never a working tree or a bare `origin/main`, which can resolve to a stale local ref.

## 6. Learning loop

- A correction, an audit finding or a bug class that repeats becomes a rule in this file the same day, with a date and the trigger in one line.

## 7. Where the rules live

- `CLAUDE.md` and `AGENTS.md` carry these rules in full. This file carries the detail and examples. All three are committed, reviewed and updated in the same pull request that introduces or changes a rule.
- Builder and sub-agent briefs say "follow CLAUDE.md and docs/ui-rules.md".
- Nothing outside the repository is a dependency.
- Project-specific learnings (token names, component names, guard names, known traps) are recorded in these files as they are found.

## Project notes

- Guard: `packages/engine/test/public-copy-lint.test.ts` fails on environment-variable-like tokens, internal hostnames and ticket ids in public output (landing and getting-started pages, emitted viewer UI, CLI error and help strings). The documented `DOCSX_*` names are allowed on reference pages and in self-host error messages only.
- States: `node scripts/layout-audit.mjs --mode states --config scripts/layout-audit.states.json` loads each page once per state (idle, pending, slow, failed, done) and fails when an element's top or height moves by more than 1 px. Unit tests pin the reserved space in emitted markup and CSS: `packages/viewer/test/viewer-style.test.ts` ("no layout shift between states"), `packages/viewer/test/starlight.test.ts` and `website/scripts/check-copy-states.test.mjs`. The screenshot error line is an overlay inside `.shot` and `.annotated-shot-frame`; copy buttons carry `aria-busy` while the clipboard write is pending.
- Burned captions: the viewer's burn code keeps badges 6 CSS px inside the image edge and uses badge-only captions on phone captures where a boxed caption would cover text. See `docs/burn-theming.md`.

## Rules log

- 2026-10-24: no environment variable names on public pages.
- 2026-10-24: carousels swipe on touch.
- 2026-10-24: centering and insets are checked, not eyeballed.
- 2026-10-24: no block sits flush to the screen edge on sheets.
- 2026-10-24: every pattern includes its mobile-native control (swipe on every carousel, drag to dismiss on sheets, touch equivalents for hover).
- 2026-10-24: the rules live in each repository's agent instructions and stay current there.
- 2026-10-24: no ticket or decision-record ids in tool descriptions, refusal text or error messages.
- 2026-10-24: lazy chunks have a stale-build path (reload once, no late focus steal).
- 2026-10-24: audits read `git archive refs/remotes/origin/main` after a fetch (a stale snapshot hid missing Spanish copy).
- 2026-10-24: status, helper, error and progress lines never shift layout (the screenshot error line was inserted under the image).
- 2026-10-24: one pending action at a time, conflicting actions disabled, state restored on failure (copy buttons accepted a second click mid-write).
