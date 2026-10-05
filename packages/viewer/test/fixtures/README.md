# Viewer test fixtures

## `legacy-burn-trees.json`

Frozen Satori trees for the scenarios in `../helpers/legacy-scenarios.ts`, as the burner produced them before adaptive callout width, `placement` and the burn report existed.

- **How it was made.** `buildBurnTree` from the viewer sources at commit `1ff822c` (`origin/main` before the narrow-screenshot work), copied unchanged into a scratch directory, run over each scenario with the vendored Inter metrics and a dummy image data URI, output written with `JSON.stringify(tree, null, 1)`. The scratch copy and its generator test were deleted afterwards.
- **What it proves.** `burn-legacy.test.ts` compares today's trees to it, so a record without `obstacles` or `placement` keeps burning to the same bytes, and a wide screenshot with `obstacles` keeps its 280 px callout.
- **Guard.** `burn-legacy.test.ts` also asserts `widthLadder(...)` is `[280]` for every annotation of every scenario. A scenario that fails that check exercises the new width logic and does not belong here.
- **Do not regenerate it from current code.** That turns the test into a comparison of the code with itself. A scenario change means regenerating from `1ff822c` (`git show 1ff822c:packages/viewer/src/<file>`), or adding the scenario to a new fixture generated that way.
