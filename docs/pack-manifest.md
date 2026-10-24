# Screens pack manifest

`docsxai pack` writes `manifest.json` next to the hash-named PNGs it produces, and `docsxai pack --check` reads one back. This page is the reference for that file (`docsxai/screens-pack@2`) and for the `pack.json` that feeds it. Available from `0.3.0-rc.1` (`docsxai@next`).

The validator is the contract. `validatePack(value)` in `@docsxai/viewer` returns every problem with a path-prefixed message, and `pack` runs it before anything is written. JSON Schema (draft 2020-12) for editors and CI: [`screens-pack-2.schema.json`](../packages/viewer/schemas/screens-pack-2.schema.json) for `manifest.json` and [`pack-config-1.schema.json`](../packages/viewer/schemas/pack-config-1.schema.json) for `pack.json`. Both ship in `@docsxai/viewer` under `schemas/` (import path `@docsxai/viewer/schemas/<file>`), and a test checks each against the validator on the same documents. The `$id` URLs name the schemas and are not served.

A JSON Schema cannot say these rules, so only the validator enforces them:

- A variant's `src` must carry the flow and step id of the keys around it, and the public prefix the caller passes to `validatePack`.
- `alt` must have every locale that one of the step's variants uses.
- `index` is unique within a variant.
- Text length counts UTF-16 units in the validator and code points in the schema, so a string of emoji can pass the schema and fail the validator.
- In `pack.json`: two `sources` names that differ only by case, and the match between screenshots on disk and `steps` entries.

## Shape

```json
{
  "schema": "docsxai/screens-pack@2",
  "generated_for": "a1b2c3d",
  "flows": {
    "login": {
      "title": { "en": "Sign in" },
      "steps": {
        "home": {
          "caption": { "en": "The sign-in page" },
          "alt": { "en": "Sign-in page with an email field" },
          "variants": {
            "en.light.1280": {
              "src": "/screens/login/home.3fa9c1d2.png",
              "width": 1280,
              "height": 800,
              "bytes": 48213,
              "callouts": [
                {
                  "index": 1,
                  "copy": "Enter your email",
                  "bbox": { "x": 410, "y": 220, "width": 320, "height": 40 }
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

Keys are sorted at every depth, callouts are in index order, there are no timestamps, and the same input gives the same text. Unknown keys are validation errors.

## Fields

| Path                            | Type                 | Required | Rule                                                                                                               |
| ------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `schema`                        | string               | yes      | Exactly `docsxai/screens-pack@2`.                                                                                  |
| `generated_for`                 | string               | no       | Free text, 1 to 128 characters. Set by `--generated-for`; omitted otherwise.                                       |
| `flows`                         | object               | yes      | 1 to 200 flows keyed by flow id.                                                                                   |
| `flows.<flow>.title`            | `{ <locale>: text }` | no       | Each text up to 200 characters.                                                                                    |
| `flows.<flow>.steps`            | object               | yes      | 1 to 500 steps keyed by step id.                                                                                   |
| `...<step>.alt`                 | `{ <locale>: text }` | yes      | At least one locale, each text up to 1000 characters. Must have every locale that one of the step's variants uses. |
| `...<step>.caption`             | `{ <locale>: text }` | no       | Each text up to 1000 characters. Not checked for locale coverage.                                                  |
| `...<step>.variants`            | object               | yes      | 1 to 64 variants keyed `<locale>.<theme>.<viewport>`.                                                              |
| `...<variant>.src`              | string               | yes      | `<public-prefix>/<flow>/<step>.<hash8>.png`. Default prefix `/screens`.                                            |
| `...<variant>.width`, `.height` | integer              | yes      | 1 to 20000, the PNG's pixels.                                                                                      |
| `...<variant>.bytes`            | integer              | yes      | Positive. Size of the file `src` names.                                                                            |
| `...<variant>.callouts`         | array                | yes      | At most 50, may be empty.                                                                                          |
| `...callouts[].index`           | integer              | yes      | 1 to 50, unique within the variant.                                                                                |
| `...callouts[].copy`            | string               | yes      | 1 to 500 characters.                                                                                               |
| `...callouts[].bbox`            | object               | no       | `{ x, y, width, height }` in the PNG's pixel space. `x` and `y` at least 0, `width` and `height` above 0.          |

Identifier grammar:

| Part       | Pattern                                | Notes                                                                 |
| ---------- | -------------------------------------- | --------------------------------------------------------------------- |
| Flow, step | `^[a-z0-9]+([-_][a-z0-9]+)*$`          | Up to 64 characters. No dots, because the hash sits between two dots. |
| Locale     | `^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$` | `en`, `pt-BR`. Not limited to en and es.                              |
| Theme      | `^[a-z][a-z0-9-]{0,23}$`               | Not limited to light and dark.                                        |
| Viewport   | `^[1-9][0-9]{2,3}$`                    | A width in px, 3 or 4 digits. Not limited to 390 and 1280.            |
| `hash8`    | `^[0-9a-f]{8}$`                        | First 8 hex digits of the sha256 of the final (optimised) bytes.      |

## `pack.json`

A workspace needs `pack.json` (`docsxai/pack-config@1`) beside `docs/`. A raw capture directory carries the same text in `step.json` and `flow.json` instead.

| Key                         | Required                        | Rule                                                                                                                                                                                           |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                    | yes                             | Exactly `docsxai/pack-config@1`.                                                                                                                                                               |
| `sources`                   | yes, unless `matrixFlow` is set | Capture flow name (`docs/<name>/`) to `{ flow, variant }`. `variant` is a pack key. An entry with `matrix` names one matrix variant directory.                                                 |
| `matrixFlow`                | no                              | `{ flow, map, auto, packFlow? }`: every variant directory of one matrix flow. `map` is `<matrix id>: <pack key>`; `auto: true` maps ids that already read `<locale>.<theme>.<viewport width>`. |
| `flows.<flow>.title`        | no                              | `{ <locale>: text }`.                                                                                                                                                                          |
| `flows.<flow>.steps.<step>` | yes                             | `{ alt, caption? }`. Every screenshot needs an entry and every entry needs a screenshot, or the pack stops.                                                                                    |

`sources` rejects the names `__proto__`, `constructor` and `prototype`, and two names that differ only by case. The runbook has the matrix forms with examples: see [Packing screenshots for a site or README](agent-runbook.md#packing-screenshots-for-a-site-or-readme-pack-pack---check).

## Version policy

- The id is `docsxai/screens-pack@N`. The current N is 2, held in code as `SCREENS_PACK_SCHEMA`.
- Adding an optional field keeps the id. A change that breaks a reader of `@N` introduces `@N+1`, and the CHANGELOG names it. [`public-surface.md`](public-surface.md) has the full policy and the stability mark for this file.
- `docsxai/screens-pack@1` (the first trackxai script) and `docsxai/screens-manifest@1` (the first remotxai script) are not written any more. `convertScreensPackV1` and `convertScreensManifestV1` in `@docsxai/viewer` turn them into `@2`.
- `pack` reads any of the three shapes in `--out` to prune the files the previous manifest listed. `pack --check` accepts only `@2` as the committed side and exits 1 on a missing or older `manifest.json`; rebuild it with `docsxai pack`.
- `pack.json` has its own id, `docsxai/pack-config@1`, versioned the same way.

## Drift in a nightly job

`docsxai pack --check <workspace> --against <pack-dir> [--threshold <pct>]` rebuilds the pack in memory without `oxipng`, writes nothing and exits 1 on a changed variant over the threshold (default 0.5), a resize, a new or missing variant, or a committed file whose name does not match its bytes. The report has no timestamps. The [CI recipes](ci-recipes.md) run `diff` by default and say to swap in `pack --check` for a workspace that uses matrix flows.
