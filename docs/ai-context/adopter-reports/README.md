# Adopter reports

Field reports from agents and teams driving docsxai against real workloads. Time-ordered. Each report drives (or has driven) surface changes through the adopter-feedback loop described in `AGENTS.md`.

## Loop

1. Report lands as `<YYYY-MM-DD>-<slug>.md`.
2. Triage: each ask gets a verdict (in the v0.x surface / behind a flag or new mode / RFC / declined).
3. Capability lane: posture-broadening asks (new auth strategy, new step-vocabulary entry, new write surface) get an explicit opt-in shape rather than expanding the default.
4. Keystone coverage: regression test against real Chromium for runtime asks; flow-file fixture for parser / lint asks.
5. CHANGELOG entry + relevant runbook update.
6. The originating report's "durable lessons captured" section points at the resulting CHANGELOG entry or roadmap phase.

## Reports

_None yet._ Prototype and MVP ran without external adopters; the first report will land when the OSS release does (owner-deferred) or when an internal adopter inside Kalebtec files one against the pre-release build.

## What goes in a report

- **Context.** Who ran it, against what target site, with what intent.
- **What worked.** The flows that landed successfully; the affordances that paid off.
- **Friction.** Every "I had to work around X" moment. Faithful capture — don't sand the edges.
- **Asks.** Concrete proposed surface changes. Each gets a triage verdict above.
- **Durable lessons captured.** What we learned that outlives this specific report.

Field reports are field reports — first-person narrative, dated, attributable when the operator consents. They're the input to surface evolution, not a rant venue and not a polished marketing artifact.
