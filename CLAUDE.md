# Claude Code instructions

Repository instructions live in `AGENTS.md` — agent-agnostic and authoritative. Read it first.

Claude-Code-specific addenda (hooks, Skills): see `.claude/`.

## UI and copy rules

Full detail in `docs/ui-rules.md`. These apply to every feature, fix and copy change, in every locale and both themes.

- Copy: no operator or private information on any user-visible surface (environment variable names a user doesn't set, config keys, internal ids, hostnames, ticket ids, procedures, infrastructure detail, internal tool names). Documented variables, flags and tool names a user is meant to set stay in reference pages. Empty states and errors say what the user does next. Cut words by about 50%, plain language, no filler, no heading restated in the next line. Never change a published promise, price or legal text.
- Design system: one spacing, radius and type scale. One component per pattern; a pattern in two places is a shared component. No raw padding, margin or font classes outside the primitives. Touch targets at least 44 px, visible focus, reduced motion respected. One floating action at most.
- Geometry: icons centred in buttons, equal left and right insets, no block flush to the screen edge, no horizontal scroll, clipped or covered content. Check 320, 360, 390, 430, 768, 1024, 1280 and 1920, portrait and landscape, keyboard open, safe areas, long strings and large text.
- Status, helper, error and progress lines never shift layout: reserve the space before the line appears (fixed-height slot or in-container overlay). Proof: element top and height are identical across idle, pending, slow, failed and done.
- While one action is pending, conflicting actions are disabled and the inputs it uses are read-only. One pending action at a time, no double submit, state restores on failure.
- Mobile-native controls ship with every pattern: swipe (snap, keyboard arrows, counter inside the frame) on carousels, galleries, lightboxes, tab strips and steppers; drag down to dismiss on sheets, drawers and modals; scrollable chip and tab rows with an edge fade; swipe or long-press row actions and a touch equivalent for every hover-only affordance; pull to refresh where data refreshes; the composer flush above the keyboard.
- Proof before push: real screenshots at 390 and 1280, before and after pairs for UI changes, one gate per batch. Every UI or copy pull request says `ui-rules checked: yes, <what was checked>`; reviewers reject it without that line.
- Strings shown to users or models (error messages, tool descriptions, refusal text) never cite ticket, decision-record or other internal ids.
- Lazy-loaded chunks need a stale-build path: a dead hashed chunk after a deploy reloads once and never retries forever, and a chunk that lands late never steals focus.
- Audits and sweeps read real main with `git archive refs/remotes/origin/main` after a fetch, never a working tree or a bare `origin/main`, which can resolve to a stale local ref.
- Learning loop: a correction, an audit finding or a repeating bug class becomes a rule in `docs/ui-rules.md`, `AGENTS.md` and `CLAUDE.md` in the same pull request. Builder and sub-agent briefs say "follow CLAUDE.md and docs/ui-rules.md".
