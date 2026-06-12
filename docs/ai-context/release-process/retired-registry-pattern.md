# The retired-registry pattern — graceful deprecation for config inputs

Read this before removing or renaming any operator-facing input: a flow-file
field or enum value, a CLI flag, an auth-strategy name, a plugin-capability
string, a workspace-config key.

## The problem

docsxai's inputs are long-lived artifacts (flow-files are committed; workspace
configs persist; plugin manifests ship in packages). Hard-removing an input
breaks every existing artifact silently or cryptically. But accepting unknown
input forever means typos pass silently. The two failure modes need different
treatment, so the parser must be able to tell them apart.

## The pattern

Each input surface keeps a **retired registry**: a map of
`formerly-valid-name → { since, replacement?, note }`.

| Input kind              | Behavior                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Currently valid         | Accept.                                                                                    |
| In the retired registry | Accept the artifact, **warn once** (name + replacement + since), ignore the retired value. |
| Unknown (never valid)   | **Loud error** — it's a typo, not history.                                                 |

Full removal of a retired entry happens only at a major version bump, with a
`### Removed` CHANGELOG entry naming it.

## Where it applies today

- Flow-file schema: zod `.strict()` objects give the loud-error half for free;
  retiring a field means moving it from the schema into the registry check
  that runs before strict parsing.
- CLI flags: `parseFlags` consumers error on missing required flags; retired
  flags warn-and-ignore at the command entry.
- Auth-strategy names (`StrategyName`) and plugin capability prefixes: the
  registry lives next to the enum; renames keep the old name retired for one
  major.
- Backend API: versioned via `Docsxai-Api-Version`; field retirement follows
  the same accept-warn-ignore shape within a major version.

## Why this is release-process

The registry is what lets the semver clock (see
[`semver-clock.md`](semver-clock.md)) treat input renames as **minor** instead
of major: the old input still works, warned, for the rest of the major. If a
change can't be expressed through the registry (semantics changed, not just
the name), it resets the clock — assume it does and flag it when unsure.
