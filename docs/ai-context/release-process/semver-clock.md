# Semver clock — the API-stable-clock

docsxai is pre-1.0. The path to 1.0 runs through an "API stable ~1 week" clock that gates the public flip.

## What's frozen today (the stable surface)

- CLI subcommand names and their documented flags (every command in [`README.md`](../../../README.md) "CLI reference").
- Flow-file schema: field names, required vs. optional, the step vocabulary, `extends:` semantics.
- `ROUTES` shape in `@kalebtec/docsxai-backend` (`packages/backend/src/api.ts`).
- ActionResult / doc-pack output shape: `annotations.json`, halt-context, the screenshot file-name pattern.
- The `BrowserDriver` interface shape and the `actionable()` predicate documented in [`docs/actionability-contract.md`](../../actionability-contract.md).

Anything explicitly marked TODO or Phase-2 in the README / package READMEs is **not** covered by the stable-surface guarantee.

## What resets the clock

- A change to a CLI subcommand name or a default flag value.
- A removed / renamed required flow-file field.
- A changed default for a documented flow-file field.
- A removed / renamed `annotations.json` field, halt-context field, or `ROUTES` path.
- A change to the `actionable()` predicate's documented behavior.
- A change to the `BrowserDriver` interface's required methods or their signatures.

If you're not sure whether a change resets the clock, assume it does and discuss in the PR.

## What does NOT reset the clock

- Additive optional flow-file fields (with documented defaults).
- Additive `annotations.json` / halt-context output fields.
- New CLI subcommands (additive surface).
- Behavior-only changes that preserve the documented contract.
- Bug fixes that bring behavior into line with documented contract.

## Decision matrix

| Change                               | Semver impact          | Clock reset |
| ------------------------------------ | ---------------------- | ----------- |
| New CLI subcommand                   | minor                  | yes         |
| New optional flow-file field         | minor / patch          | no          |
| New required flow-file field         | major (pre-1.0: minor) | yes         |
| Renamed CLI subcommand               | major (pre-1.0: minor) | yes         |
| Renamed flow-file field              | major (pre-1.0: minor) | yes         |
| New `annotations.json` output field  | minor                  | no          |
| Removed `annotations.json` field     | major (pre-1.0: minor) | yes         |
| `BrowserDriver` interface change     | major (pre-1.0: minor) | yes         |
| `actionable()` behavior change       | major (pre-1.0: minor) | yes         |
| Backend `ROUTES` path change         | major (pre-1.0: minor) | yes         |
| Behavior fix (matches docs)          | patch                  | no          |
| Behavior change (diverges from docs) | minor                  | yes         |

## Pre-1.0 minor bumps

Every minor bump pre-1.0 may include surface changes. The clock guards against _frequent_ surface changes — not against any change. The "~1 week" target is for the API surface to be quiet enough that adopters can integrate without a moving target.

## When the clock matters

Once the OSS release lands (≥ Phase 3 per owner decision), the clock starts. Until then, the surface can move freely — but the discipline above is the shape the surface needs to settle into _before_ the public flip. Every Phase-1/2 surface decision is a draft of the eventual 1.0 contract.

## Related

- [`branch-protection.md`](branch-protection.md)
- [`../../../CHANGELOG.md`](../../../CHANGELOG.md)
- [`../../../RELEASING.md`](../../../RELEASING.md)
