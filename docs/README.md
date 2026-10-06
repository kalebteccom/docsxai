# Docs

Design notes, runbooks, and developer docs for docsxai. This tree — together with
`AGENTS.md` at the repo root and the agent-facing rationale under
[`ai-context/`](ai-context/) — is the source of truth for _what_ the project is
and _how_ it is built.

Start with [`agent-runbook.md`](agent-runbook.md) (the hand-to-an-agent calibration
workflow), [`agent-guidance.md`](agent-guidance.md) (the reach-for-this-not-that
footgun map), and [`running-against-an-app-repo.md`](running-against-an-app-repo.md);
the cross-repo contracts are [`actionability-contract.md`](actionability-contract.md)
and [`browxai-asks.md`](browxai-asks.md). What counts as public surface, how
stable each item is, and the deprecation policy are in
[`public-surface.md`](public-surface.md).

## How these reach the docs site

The rendered site at docsxai.dev is written for end users. Agent-facing content stays
in these sources and reaches agents as plaintext Markdown linked from `llms.txt`:

- `agent-runbook.md` and `agent-guidance.md` have no HTML page. They are served only
  as `/guides/agent-runbook.md` and `/guides/agent-guidance.md`.
- Every other published page also has a `.md` twin (`/reference/cli.md`, and so on).
- An agent-only note inside an end-user page is a blockquote that opens with
  `**For agents:**`. The site port turns it into a Starlight `:::caution[For agents]`
  aside, the HTML build strips it, and the `.md` twin keeps it. Hand-written site pages
  under `website/src/content/` write the aside directly.

`pnpm docs:build` fails if a rendered page keeps a "For agents" aside, a twin loses
one, or an agent page renders HTML (`website/scripts/check-agent-surface.mjs`).
