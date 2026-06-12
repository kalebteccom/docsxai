# Validation-agent repo-write policy

Applies to any agent driving docsxai (or a sibling tool) against a real target as a
_consumer_ — adoption runs, calibration validation, re-validation passes. It exists because a
well-meaning validation agent once "helpfully" landed an unreviewed feature in the tool repo
mid-run, and the maintainers had to untangle the drift.

## The rule

**A validation agent must not edit, create files in, or commit to this repo** (or any sibling
tool repo it is validating). Calibrating against a real target does not license source, doc, or
test changes to the tools themselves — even obviously-correct ones. Unreviewed, unattributed
drift is worse than a written request.

The agent's writable surface is **only**:

- The **consumer workspace** (e.g. `~/docsxai/<target>/`, its own git repo) — flows, the doc
  pack, the zip, and the agent's own commits there are fine.
- A **requests + findings file in the consumer workspace**: `REQUESTS-<YYYY-MM-DD>.md`.
  Everything the agent would otherwise want to change in a tool repo — bug reports, adoption
  findings, proposed code/doc changes, new asks — goes **there as a written request**, not as a
  direct edit. Include enough detail (repro, file/line, proposed diff sketch) that a maintainer
  can action it without re-deriving it.

If the agent believes a tool-repo change is needed, it **writes the request and stops there**.
Maintainers apply tool-repo changes after review.

## Companion constraints

- **No-trace contract.** `git status --porcelain` on the tool repo(s) and on the target app's
  source repo must be empty at teardown — the agent wrote nothing there.
- **Sanitise the findings file.** It feeds public-bound docs: no client, product, asset, cookie,
  or route names; no operator-local filesystem paths.
- **Don't grind.** More than ~5 stuck tool calls on the same obstacle → add a
  `## BLOCKER: <topic>` section to the requests file and surface it to the human. Don't write
  blocker files into the tool repos.

## Related

- [`commit-discipline.md`](commit-discipline.md) — commit rules for the consumer workspace too
  (single-line conventional ≤72 chars, no AI trailers).
- Repo-root [`AGENTS.md`](../../../AGENTS.md) — the contributor-facing operating rules (a
  validation agent is _not_ a contributor; that's the point of this page).
