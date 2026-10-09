# Flow matrix: one flow file, many variants

Decision note for the `matrix:` key. Read before touching `flow-matrix.ts`, the `run` unit loop, or the doc-pack layout.

## Problem

`workspaces/trackxai-docs` keeps `desktop-1280.flow.yaml` and `mobile-390.flow.yaml`, 560 lines each, which differ in about 60. remotxai varies locale and theme by hand in its harness. The `environment` block pins one viewport, one scheme, one locale per flow, so every variant is a copy.

## Shape

A top-level `matrix:` key with three optional axes, at least one required:

```yaml
matrix:
  locales: [en-US, es-ES]
  color_schemes: [light, dark]
  viewports:
    - { name: desktop-1280, width: 1280, height: 800 }
    - mobile # a named preset (desktop, tablet, mobile)
```

- Each list holds 1 to 64 unique entries. The product is capped at `MAX_MATRIX_VARIANTS` (64). Over the cap is a parse error that names the product and the three list sizes.
- A viewport entry is a preset name or `{ width, height }` with an optional `name`. Names are lowercase `[a-z0-9-]`. An unnamed object entry is identified as `<width>x<height>`; a preset is identified by its preset name.
- Each variant overrides the flow's `environment` for the axes the matrix names. Axes the matrix leaves out keep the flow's own `environment` value. `clock`, `timezone` and `reduced_motion` are never matrix axes.
- `matrix` is not inherited through `extends`. The expansion runs on the merged flow and uses the child's `matrix` only.

### Per-variant content

- Steps and annotations accept `only:` and `skip:`, each a map from axis (`viewport`, `color_scheme`, `locale`) to a list of values. A clause matches a variant when every axis it names matches. `only` keeps matching variants. `skip` drops matching variants. Both may be set. A locale value `es` matches `es-ES`. A value that no matrix entry can match is a parse error, so a typo cannot silently drop a step.
- Annotations accept `copy_by_locale: { es: "...", fr-FR: "..." }`. `copy` stays required and is the fallback, so every reader of `copy` (diff, exports, the viewer) keeps working. Lookup order: the variant locale exactly, then its language subtag, then `copy`. The variant locale is the matrix locale, or the flow's `environment.locale` when the matrix has no locales.
- Anything else that differs per variant (arrow side, placement) is written as two annotations with `only:` on each.
- A variant left with no steps is an error.

### Expansion

`expandFlow(flow)` is pure and returns `[{ id, info, flow }]`. The variant flow has no `matrix`, no `only`/`skip`, no `copy_by_locale`, and carries the merged `environment`. Without a `matrix` it returns one entry with `id: null` and a flow equal to the input (a flow with no `only`/`skip`/`copy_by_locale` keeps the same step objects). Order is the cartesian product with locales outermost, then color schemes, then viewports, each in declared order. The id is the axes present, joined by `.`: `en-US.dark.desktop-1280`. Declared order is the only ordering rule, so two parses of one file expand identically.

## Layout

| Flow        | Screenshots                                    | Annotations                              | Halt shots                               |
| ----------- | ---------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| no matrix   | `docs/<flow>/screenshots/<step>.png`           | `docs/<flow>/annotations.json`           | `docs/<flow>/halts/<step>.png`           |
| with matrix | `docs/<flow>/<variant>/screenshots/<step>.png` | `docs/<flow>/<variant>/annotations.json` | `docs/<flow>/<variant>/halts/<step>.png` |

A flow without a matrix writes the same paths and the same bytes as before. A regression test runs the existing `recap-open` fixture and compares against the prior layout and annotation bytes.

`annotations.json` of a variant carries a `variant` object after `flow`: `{ id, locale?, color_scheme?, viewport?: { name?, width, height } }`. The schema string stays `docsxai/annotations@1`; the field is optional, so older files stay valid.

Alternatives rejected:

- `docs/<flow>.<variant>/`: the viewer needs no change, but `<flow>.` collides with flow names that hold dots and loses the grouping.
- A `variants/` subdirectory: one more level with no information.

## Runtime

One Playwright session per variant, since `environment` is a context option. `docsxai run` expands each flow into units, runs units with the existing concurrency cap, and writes each unit's artifacts to its variant directory. `--variant <id>` limits a run to one variant. `--cdp` is rejected for a matrix flow because the attached context cannot take a viewport, scheme or locale. `runFlow` refuses a flow that still carries a `matrix`, so a caller that skips expansion fails loudly.

A halt names the variant: `[<cause>] [variant en-US.dark.desktop-1280] step "x" (click) failed at <url>: ...`. `FlowExecutionError.variant` carries the id.

## Calibration aids

- `lint` adds R015 (info) listing the variants a flow expands to, and R016 (warning) for a `copy_by_locale` key that no variant locale can use. Locales missing from `copy_by_locale` are not flagged: `copy` is the intended fallback.
- `flow-tree` appends the variant list to a flow with a matrix. Flows without a matrix print as before.
- `diagnose` takes `--variant <id>`. Without it on a matrix flow, `diagnose` lists the variants, names the ones that hold a halt shot for the step, and picks the only one when exactly one does.

## Consumers

- `docsxai-viewer burn` and `render` discover `docs/<flow>/<variant>/annotations.json` and treat `<flow>/<variant>` as the flow name. That is the one viewer change: `discoverFlows` takes `{ variants: true }`, and `burn --flow <flow>` also selects its variants. The Starlight emitter keeps flat discovery.
- `push`, `pull` read and write variant directories: the annotation and screenshot keys become `<flow>/<variant>/...`.
- `zip` already walks `docs/` recursively.
- `pack` and `pack --check` read the variant directories through `pack.json`: a `sources` entry with `matrix` names one, a `matrixFlow` block maps all of them (`packages/viewer/src/pack-matrix.ts`). Matrix ids and pack keys stay two grammars.
- Not covered yet: `baseline` and `diff` (drift) read flat flow directories, `export` refuses a matrix flow, and the MCP `run_flows` and `diagnose_halt` tools do not expand variants (`runFlow` makes `run_flows` fail with a clear message).

## Determinism

Expansion reads only the parsed flow. Variant order, ids, merged environments and resolved copy are pure functions of the file, so the same file and the same target state give the same bytes per variant. The keystone runs a 2x2 matrix twice on the toy site and compares every PNG and `annotations.json`.
