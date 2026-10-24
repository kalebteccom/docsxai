# Viewer test fixtures

## `legacy-burn-trees.json`

Frozen Satori trees for the scenarios in `../helpers/legacy-scenarios.ts`, as the burner produced them before adaptive callout width, `placement` and the burn report existed.

- **How it was made.** `buildBurnTree` from the viewer sources at commit `1ff822c` (`origin/main` before the narrow-screenshot work), copied unchanged into a scratch directory, run over each scenario with the vendored Inter metrics and a dummy image data URI, output written with `JSON.stringify(tree, null, 1)`. The scratch copy and its generator test were deleted afterwards.
- **What it proves.** `burn-legacy.test.ts` compares today's trees to it, so a record without `obstacles` or `placement` keeps burning to the same bytes, and a wide screenshot with `obstacles` keeps its 280 px callout.
- **Guard.** `burn-legacy.test.ts` also asserts `widthLadder(...)` is `[280]` for every annotation of every scenario. A scenario that fails that check exercises the new width logic and does not belong here.
- **Do not regenerate it from current code.** That turns the test into a comparison of the code with itself. A scenario change means regenerating from `1ff822c` (`git show 1ff822c:packages/viewer/src/<file>`), or adding the scenario to a new fixture generated that way.

## `engine-matrix/`

A workspace laid out as `docsxai run` writes a flow with a `matrix:` block: `docs/login/<variant id>/screenshots/<step>.png` and `docs/login/<variant id>/annotations.json` (with the `variant` record) for the ids `en-US.light.desktop-1280` and `es-ES.dark.mobile-390`, plus a `pack.json` that maps both to pack keys. `../pack-matrix.test.ts` copies it to a temporary directory. The PNGs are solid-colour images (160x100 and 80x140) written once by a throwaway script; they are not generated at test time.

## `trackxai/`

Capture sidecars (`trackxai/raw-capture-sidecar@1`) of a dense app, copied unchanged from a real `docsxai run` at 1280x800 and 390x844, English and dark: each annotation's target box, copy, side hint and up to 40 boxes of the text-bearing elements near it. `../burn-real-sidecars.test.ts` burns them on a synthetic screen that draws a text-like pattern in every listed box, and checks that no caption covers listed text, another target, another caption or a badge, and that every badge sits next to its target. The screenshots are not checked in. `issue-label-crop.png` is a 200 x 40 px cut (x 0, y 392) of the same app's 390 px dark capture, holding the grey `Issue a token` form label; `../burn-clean.test.ts` checks the pixel text finder sees it.

## `remotxai/`

Target and obstacle boxes of one annotation from a real remotxai capture at 1280x800 (`yolo-mode/yolo-enabled`, English and Spanish, dark), converted to annotation records (`bbox` renamed `bounding_box`, `step` and `selector` filled in). The target is a 64 by 16 px pill with a title above it, a status label to its right, an icon to its left and a chip row below, so every straight line from it crosses text. `../burn-route.test.ts` burns them on a synthetic screen with a text-like pattern in every listed box and checks that the drawn line crosses none of them. The screenshots are not checked in.
