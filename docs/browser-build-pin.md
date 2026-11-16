# Browser build pin

Design for roadmap item 4. Status: steps 1 and 2 shipped (`annotations.json` and the pack manifest record the build). `pack --check` prints a warn-only build line. The same for `diff` is open.

## Problem

Screenshots are byte-identical for one docsxai version on one Chromium build. A Playwright bump or a runner image change moves the build, and every screenshot in a pack can change at once. `diff` and `pack --check` then report that as drift in every image, which hides what changed and sends an author hunting for a UI change that never happened.

## Proposal

1. **Record the build.** At the start of a run the engine reads the browser's reported version and writes it into each flow's `annotations.json` as an optional key, `browser_build`, next to `device_scale_factor` (PACK-20 is the precedent: an optional key on `docsxai/annotations@1`, so no schema bump). Format: the string the browser reports, for example `Chromium 140.0.7339.16`. Runs against a remote browser over CDP record what that browser reports.
2. **Carry it into the pack.** `pack` copies the build into `manifest.json` as an optional top-level key. A pack made before this change has none, and a missing key never counts as a mismatch.
3. **Compare it first.** `diff` and `pack --check` compare the recorded build of the baseline with the build of the current run before any pixel comparison. On a mismatch they print one line that names both builds, then still run the pixel comparison and mark its findings as "build changed" in the report. A pull request that bumps Playwright then reads as one cause, with the drift list below it.
4. **Say how to accept it.** The mismatch line ends with the next step: regenerate the baseline (or the pack) on the new build and commit it.

## Open decisions

- **Exit code on a mismatch.** Options: warn only (exit follows the pixel result), or fail (a build change always needs a refreshed baseline). Safest default is warn only, with `--fail-on` untouched. This is a product decision. Parked for the owner.
- **Surface level.** A new optional key on `annotations@1` and on the pack manifest is additive and `experimental` in `docs/public-surface.md`. It needs a new row there and a contract test.
- **Remote browsers.** A CDP session can report a branded build string. Compare the major version only, or the full string? Start with the full string and loosen if adopters report noise.

## Build steps

1. Engine: read the version in the driver launch path, write `browser_build` in the doc-pack writer, with a unit test and a keystone test against real Chromium.
2. Pack: copy the key into the manifest and extend the viewer's validator and JSON Schema (unknown keys are errors today).
3. Diff and `pack --check`: compare first, print one line, mark findings. Text, markdown and JSON renderings.
4. Docs: `docs/public-surface.md` row, `docs/pack-manifest.md` field table, `docs/ci-recipes.md` note on pinning the version, changelog.

Step 1 and 2 ship together. Step 3 follows. Each is one pull request.

## Not in scope

- Installing a specific Chromium build for the user. Playwright ties the build to its own version, so pinning `playwright-core` pins the build.
- Cross-build comparison. A mismatch is reported, and thresholds stay as they are across builds.
