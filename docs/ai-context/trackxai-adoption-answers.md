# trackxai adoption: ten answers on `pack`, matrix and CI

Answers to the ten questions from the trackxai lead's first read of `docsxai@0.3.0-rc.1`. Each one cites the source. Nothing here was run: no build, no test, no browser. Where a claim rests on a test, the test is named. Where it rests on reading, the answer says so.

Basis:

- The published rc is the tag `v0.3.0-rc.1` (`a270f9d`). The pack, matrix, drift, optimiser and runtime files cited below are byte-identical between that tag and `main` (`1740660`). `cli-commands-docpack.ts`, `cli-commands-pack.ts` and the viewer's `index.ts` changed since the tag in argument parsing and message wording only (diffed). The burner's numbered-badge fill also changed (`packages/viewer/src/burn.ts`, `#e8590c` in the rc, `#c2410c` on `main`), so a pack built with the rc and one built with a later release differ in every PNG that carries a numbered badge.
- trackxai's files were read from branch `feat/docsxai-screens-pack` (`bf2c7d4`) in the trackxai clone. The local `main` (`530942a`) does not hold `e2e/docsxai/`, and `86582063` is not in that clone. The flows live in `e2e/docsxai/flows/`.
- Line numbers refer to `main`.

## 1. Does `pack` read the matrix layout?

No. `pack` reads flat `docs/<capture-flow>/screenshots/<step>.png` and `docs/<capture-flow>/annotations.json`. A matrix run writes `docs/<flow>/<variant>/screenshots/`, and nothing in `pack` looks one level down.

Evidence:

- `packages/viewer/src/pack-workspace.ts:126-132` joins `docs/<source name>` with `screenshots` and throws `no screenshots under <ws>/docs/<name>/screenshots` when it finds no PNG.
- `pack-workspace.ts:34,74-75` limits a `pack.json` source name to `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`, so `screens/en-US.light.desktop-1280` is refused as "not a flow name".
- `packages/viewer/src/pack-cli.ts:79-89`: a workspace with `docs/` and no `pack.json` stops with "has docs/ but no pack.json". The file `pack.draft.json` is not read under that name.
- The run side: `packages/engine/src/flow-runtime.ts:207-208` and `flow-matrix.ts:84-86` write `docs/<flow>/<variant>/screenshots/<step>.png` for a flow with a `matrix`.
- Tested: `packages/viewer/test/pack-source.test.ts:377-391` (a source with no screenshots fails with the message above). The matrix-to-pack gap itself has no test, since nothing handles it.
- `docs/public-surface.md` (PACK-18 and open decision 11) records the same limit: "reads `docs/<capture-flow>/` only, not the matrix layout".
- A change that adds matrix input to `pack` is planned and not in `0.3.0-rc.1` or `main`.

Workaround today, a post-run copy (recommended). After `docsxai run`, copy each variant into a scratch workspace as a flat capture flow, and generate `pack.json` from the `variant` object that `annotations.json` already carries:

```sh
# from e2e/docsxai, after: docsxai run . --flow screens
set -eu
WS=.pack-ws
rm -rf "$WS" && mkdir -p "$WS/docs"
for ann in docs/*/*/annotations.json; do
  flow=$(jq -r '.flow' "$ann")
  lang=$(jq -r '.variant.locale | split("-")[0] | ascii_downcase' "$ann")
  scheme=$(jq -r '.variant.color_scheme' "$ann")
  width=$(jq -r '.variant.viewport.width' "$ann")
  name="${flow}_${lang}_${scheme}_${width}"
  mkdir -p "$WS/docs/$name"
  cp -R "$(dirname "$ann")/screenshots" "$WS/docs/$name/screenshots"
  cp "$ann" "$WS/docs/$name/annotations.json"
  printf '%s\t%s\t%s\n' "$name" "$flow" "$lang.$scheme.$width"
done > "$WS/sources.tsv"
jq -Rn '[inputs | split("\t") | {key: .[0], value: {flow: .[1], variant: .[2]}}] | from_entries' \
  "$WS/sources.tsv" > "$WS/sources.json"
jq --slurpfile s "$WS/sources.json" '. + {sources: $s[0]} | del(.flows.consent)' \
  pack.draft.json > "$WS/pack.json"
docsxai pack "$WS" --out pack --generated-for "$(git rev-parse HEAD)"
```

Notes on the script (not run; the first run is its test):

- `del(.flows.consent)` stays until the consent flow runs. `pack-workspace.ts:168` stops with `flows["consent"] has no source feeding it` when a flow in `pack.json` has no source.
- Add `.pack-ws/` to `e2e/docsxai/.gitignore`.
- Variant keys come out as `en.light.1280`, `es.dark.390` and so on. See question 2 for why `en`, not `en-US`.
- Needs `jq`. The trackxai CI image installs it (`deploy/dev-vm/ci-image/Dockerfile`).

The other route is flat flow files per variant (question 3). It costs more.

## 2. Matrix variant id versus pack variant key

Two grammars, no conversion between them.

Matrix variant id (`packages/engine/src/flow-matrix.ts:62-67`): the present axes joined by `.`, in the order `<locale>.<color_scheme>.<viewport name>`.

- Locale: as written in the matrix, matching `^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$` (`environment-spec.ts:23-25`). `en-US` stays `en-US`.
- Color scheme: `light` or `dark` (`environment-spec.ts:27`).
- Viewport name: a preset name (`desktop`, `tablet`, `mobile`), or the `name` of an object entry, matching `^[a-z0-9][a-z0-9-]*$`, or `<width>x<height>` when unnamed (`matrix-spec.ts:18-20,40-47`).

Pack variant key (`packages/viewer/src/pack-schema.ts:14-18,63-73`): exactly three dot-separated segments.

- Locale: `^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$`, so a lowercase language and up to two subtags.
- Theme: `^[a-z][a-z0-9-]{0,23}$`.
- Viewport: `^[1-9][0-9]{2,3}$`, a bare integer of 3 or 4 digits.

So `en-US.light.desktop-1280` fails on the third segment. Two more consequences:

- `pack-validate.ts:168-170` requires the step's `alt` to carry the variant's exact locale. A key `en-US.light.1280` needs `alt["en-US"]`. The draft's `alt.en` and `alt.es` cover keys that start with `en` and `es`.
- Nothing in `engine/` imports `parseVariantKey`, and no code in `viewer/` maps ids to keys. The only mapping today is the one written into `sources` by hand, or by the script in question 1.

Evidence is by reading. `pack-source.test.ts:112` tests that a PNG whose name is not a key is refused.

## 3. Is `extends` the supported fallback to the matrix?

It works as a fallback, with limits. It is composition, and it can pin one variant per child flow. It does not replace the matrix.

What `resolveFlowExtends` does (`packages/engine/src/flow-file.ts:157-212`):

- Steps: parent's first, then the child's (`:209`). The child needs at least one step of its own (`doc-pack.ts` `steps: z.array(Step).min(1)`), and step ids must be unique across the merge (`:193`).
- `environment`: merged per key, the child's keys win (`:199`). A child can pin `locale` and `color_scheme` and inherit the parent's `viewport`, `clock`, `timezone`.
- `matrix`: not inherited (`:205`). A parent with a `matrix` loses it in the child.
- A flow without a `matrix` writes the flat layout, so each child writes `docs/<child>/screenshots/` and `pack.json` can name it as a source.
- `copy_by_locale` works without a matrix. It resolves against `environment.locale` (`flow-matrix.ts:256-259`).
- `only` and `skip` do not work without a matrix. They fail with "needs a `matrix`" (`flow-matrix.ts:249-255`, tested at `packages/engine/test/flow-matrix.test.ts:206`; the `extends` merge rules at `:333-390`).

For trackxai that last point bites: `screens.flow.yaml` uses `only: { viewport: [desktop-1280] }` on 11 annotations. Flat children need two parent flows (a desktop one and a mobile one, each with its own annotation set) and 8 children of about 8 lines each. The parents also run on their own unless the run uses `--flow`. A child looks like:

```yaml
name: screens-en-light-1280
extends: screens-desktop-base
environment:
  locale: en-US
  color_scheme: light
steps:
  - id: end
    action: wait
```

Recommendation: keep the matrix and use the copy in question 1.

## 4. Which steps write a screenshot?

Only a step that has `annotation` or `annotations` after variant resolution. The step id is the file name: `docs/<flow>[/<variant>]/screenshots/<step id>.png`.

Evidence:

- `packages/engine/src/flow-runtime.ts:416` builds the annotation list from `annotations` or `annotation`. `:427` captures only when `captureDocs && anns.length > 0`. No other action captures, whatever it is (`navigate`, `click`, `wait`, `hide`, `show`).
- `flow-matrix.ts:155-175` (`resolveStep`) drops annotations whose `only`/`skip` does not match the variant. A step left with none writes no screenshot in that variant, and it is not an error.
- A step whose capture throws is skipped with a stderr line `annotation capture skipped` (`flow-runtime.ts:452-456`). `pack` then stops with `flows["screens"].steps["<id>"] has no screenshot` (`pack-workspace.ts:170-171`), and a screenshot with no `steps` entry stops with `pack.json has no flows[...].steps[...]` (`pack-workspace.ts:139-142`). The match must be exact in both directions, per source.
- An `optional: true` step that fails writes nothing (`flow-runtime.ts:371-376`).
- Halt shots go to `halts/`, outside `screenshots/` (`flow-runtime.ts:380`), so `pack` never sees them.

Applied to trackxai's `screens.flow.yaml`: the guard steps (`*-open`, `*-idle`, `*-no-loopback`, `tokens-hide-url`, `tokens-show-url`) carry no annotation, so they write nothing. The six steps that do (`board`, `ticket-panel`, `progress`, `activity`, `account`, `tokens`) each keep at least one annotation without `only` in every variant. That matches the six `steps` in `pack.draft.json`. Your assumption is right. A step id must also pass `^[a-z0-9]+([-_][a-z0-9]+)*$` (`pack-schema.ts:12`), and these do.

## 5. Identical light and dark bytes

`pack` accepts them. Two variant keys of one step then share one file name and one manifest `src`. By reading, no step rejects this; no test covers it.

Evidence:

- The file name is `<flow>/<step>.<hash8>.png` with `hash8` taken from the final bytes (`pack-build.ts:61-62,92`), with no variant in the name. Two variants with equal bytes yield one key in the `files` map (`pack-build.ts:112`), so the file is written once, and both variants point at it (`:115-121`).
- The validator checks each variant's `src` against the pattern and nothing else about it (`pack-validate.ts:113-138`). There is no uniqueness rule across variants.
- `writePack` writes by path and prunes by a de-duplicated set (`pack-write.ts:62-72`). `pack --check` compares each variant separately and reads the shared file twice (`pack-drift.ts:42-50,160-177`).
- Equal bytes need equal inputs. Both variants must have the same raw PNG and the same annotation records (same `bounding_box`, same `copy`), because the burner runs on both. The burner is deterministic (`pack-build.test.ts:424`), but that test does not cover light against dark.
- What would break the match: any style that reacts to `prefers-color-scheme`, including a `color-scheme` property that changes native scrollbars or form controls. The first run shows it. If the PNGs differ, they are two files, which is also valid.

The guard that stops a build is the text scan (`pack-guards.ts`), and it does not look at images.

## 6. The drift gate for a matrix workspace

`pack --check` is the gate. `docsxai diff` and `baseline` do not see matrix screenshots.

`pack <ws> --check --against <pack dir> [--threshold <pct>]` (`pack-cli.ts:146-169`, `pack-drift.ts`):

- Rebuilds the pack in memory from the current `docs/` and `pack.json`, without `oxipng` (`pack-cli.ts:158`), and compares it with the committed `manifest.json` and PNGs.
- Per variant, `<flow>/<step>/<variant key>`: an equal `hash8` is unchanged. Otherwise the two PNGs are compared pixel by pixel (exact RGBA, transparent read as white). The result is the changed share of the full area, rounded to 4 decimals (`pack-pixels.ts:28-67`). A pixel-identical rebuild with other bytes (an optimiser difference) passes.
- Fails on: a change above the threshold (`pct > threshold`, default `0.5`, `pack-drift.ts:14,141`), a resized image, a new variant, a missing variant, and a committed file that is absent or does not match its name. A change at or under the threshold is listed and passes.
- Exit 0 when nothing fails. Exit 1 when anything fails and on any error, including a missing or invalid committed `manifest.json` (`pack-cli.ts:166-169`, `pack-cli.test.ts:360`). Exit 2 for a bad argument (`pack-cli.ts:59-62`; the engine wrapper `cli-commands-pack.ts:55-64`).
- The report goes to stdout, sorted, without timestamps.

Two limits:

- 0.5% of a 1280x800 image is 5,120 pixels. A one-callout text change can fall under that and pass. `--threshold 0` fails on any changed pixel.
- Alt text, captions and callout metadata are not compared, only pixels, sizes and the variant set.

`docsxai baseline` and `diff` (`packages/engine/src/cli-commands-docpack.ts:296-312`, `diff-compute.ts:259-262`) read only `docs/<flow>/screenshots/` and `docs/<flow>/annotations.json`. A matrix flow has neither, so the baseline holds no PNGs for it and `diff` reports no screenshot drift, with exit 0 even under `--fail-on warn`. It still compares the flow YAML (steps, locators). Its thresholds are 1% warn and 5% fail (`diff-compute.ts:352-353`). Drop the `diff` line from the nightly recipe for a matrix workspace. `run --verify-determinism` (exit 1 when two runs of the same flow differ) works on matrix flows and is a separate check.

`flow-matrix-decision.md` lists `baseline` and `diff` under "Not covered yet", which still holds.

## 7. The install line and the bins

```sh
npm install --global docsxai@0.3.0-rc.1
```

`docsxai@next` resolves to the same version today. Pin the number so a later `next` does not change the burner under a committed pack. A bare `npm install --global docsxai` installs `0.2.0`, because `latest` is `0.2.0`; that release has no `pack`.

Verified with `npm view` (metadata only):

- Dist-tags: `latest` = `0.2.0`, `next` = `0.3.0-rc.1`. Published 2026-10-07.
- `docsxai@0.3.0-rc.1`: tarball `https://registry.npmjs.org/docsxai/-/docsxai-0.3.0-rc.1.tgz`, integrity `sha512-4bsFiY72ZYcVdZ9L6Y8bI8xSOt/XU++w+hy05NBTusyfSid6rgVq0SoD5iBse33E7iwqvsfHpcfNzfbz+X9rxQ==`, `engines.node >=26`.
- Its dependencies: `@docsxai/engine` and `@docsxai/viewer`, both `0.3.0-rc.1`.
- `v0.2.0` has no `pack-*.ts` files in `packages/viewer/src` (checked in git).

Bins:

- The meta package declares one bin, `docsxai` (`bin.mjs`). It runs `@docsxai/engine/cli` in-process (`packages/docsxai/bin.mjs:23`). `@docsxai/engine` declares `docsxai` (`dist/cli.js`). `@docsxai/viewer` declares `docsxai-viewer` (`dist/index.js`).
- `pack`, `burn` and `render` start the viewer as a child process. Resolution order (`packages/engine/src/viewer-bin.ts:73-115`): `DOCSX_VIEWER_BIN`, then the `@docsxai/viewer` package next to the engine, then `docsxai-viewer` on PATH.
- `bin.mjs:13-20` sets `DOCSX_VIEWER_BIN` from `import.meta.resolve("@docsxai/viewer")` when it is unset, so a global `docsxai` finds its viewer without help.
- `packages/docsxai/README.md` says the `docsxai-viewer` bin also lands on PATH. I expect npm to link only the top-level package's bins on a global install, so I would not rely on that. Not tested here, and the CLI does not need it.

The recipes in `docs/ci-recipes.md` and `examples/ci/` use the bare `npm install --global docsxai` line. Until `latest` moves to 0.3.x they install a version without `pack`. That is a docs gap, not fixed here.

## 8. oxipng on a Debian CI image

The trackxai CI image is `node:<major>-bookworm` (Debian 12) (`deploy/dev-vm/ci-image/Dockerfile`, `FROM node:${NODE_MAJOR}-bookworm`).

There is no apt package. `packages.debian.org` has no `oxipng` binary package for bookworm or trixie (checked 2026-10-08); sid has only the library `librust-oxipng-dev`. Install a pinned release binary and verify its checksum. The musl build is static, so it has no glibc dependency:

```dockerfile
ARG OXIPNG_VERSION=10.2.1
ARG OXIPNG_SHA256=1813750ef592c5350ca79c88f98b2c0876d05c826dc7156245256d4255c1ad17
RUN curl -fsSL -o /tmp/oxipng.tgz "https://github.com/oxipng/oxipng/releases/download/v${OXIPNG_VERSION}/oxipng-${OXIPNG_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
 && echo "${OXIPNG_SHA256}  /tmp/oxipng.tgz" | sha256sum -c - \
 && tar -xzf /tmp/oxipng.tgz -C /tmp \
 && install -m 0755 "/tmp/oxipng-${OXIPNG_VERSION}-x86_64-unknown-linux-musl/oxipng" /usr/local/bin/oxipng \
 && rm -f /tmp/oxipng.tgz
```

I downloaded that tarball once and checked: its sha256 is the value above, and it holds `oxipng-10.2.1-x86_64-unknown-linux-musl/oxipng`. The release also ships `oxipng_10.2.1-1_amd64.deb`, which I did not check against bookworm's glibc. The newest tag at the time of writing is `v10.2.1` (2026-09-02).

The version matters only where `oxipng` runs. `pack` hashes the optimised bytes, so a different oxipng version can rename every file (`pack-optimise.ts:1-3`). `pack --check` does not run oxipng at all (`pack-cli.ts:158`, tested at `pack-cli.test.ts:366-373`), and compares pixels, so the nightly job passes with no oxipng in the image. Only the refresh step (`pack --out pack`) needs it. Pin the same version on the machine that refreshes and in CI, or refresh in CI only.

`DOCSX_OXIPNG_BIN` names the binary and wins over PATH (`pack-optimise.ts:63-65`). `pack --no-optimise` skips oxipng (`pack-cli.ts:112-114`) and names files after the burned bytes.

When oxipng is missing and `--no-optimise` is not given (`pack-cli.ts:112-114,139-142`, `pack-optimise.ts:68-80`):

- Exit 1. Stderr: `pack: oxipng not found on PATH. Install it with: brew install oxipng`. Nothing is written (tested at `pack-cli.test.ts:243-250`).
- With `DOCSX_OXIPNG_BIN` set to a path that does not exist: `pack: oxipng not found at <path> (DOCSX_OXIPNG_BIN)`, exit 1.
- The check runs after the source is read, so a bad `pack.json` is reported first.
- The `brew install` hint is wrong on Debian. That wording is a small docs gap.

## 9. Names of unplaceable callouts

`docsxai burn <ws> --flow screens --report <file>` writes `docsxai/burn-report@1` to `<file>`, resolved against the workspace when relative (`packages/viewer/src/index.ts:313-320`). `burn` reads the matrix layout directly: `--flow screens` also selects every `screens/<variant>` output (`index.ts:282-287`).

The report (`packages/viewer/src/burn-report.ts:18-54`):

- `flows[].flow` is `screens/en-US.light.mobile-390`.
- `flows[].annotations[]` has `step`, `index` (1-based, `null` for an un-numbered annotation), `selector`, `mode`, `side`, `callout`, `badge`, overlaps, `overlap_ratio`, `unplaceable` and, for a skipped one, `skipped`.
- `unplaceable` is true when `overlap_ratio` is above `threshold` (default 0.1). The top-level `unplaceable` counts them.
- The report holds no callout copy. The name of a callout is the triple flow/variant, `step`, `index`. The copy is in `docs/<flow>/<variant>/annotations.json`, same `step` and `index`.

`pack` and `burn` use the same renderer (`pack-build.ts:34`, `burn.ts` `burnFlow`) and the same default ratio, so the report matches the count that `pack` prints (`pack-cli.ts:133-137`). The count adds up across all variants, light and dark twice.

```sh
docsxai burn . --flow screens --out .burn-check --report burn-report.json
jq -r '.flows[] | .flow as $f | .annotations[] | select(.unplaceable)
       | [$f, .step, (.index // 0)] | @tsv' burn-report.json |
while IFS=$(printf '\t') read -r f step idx; do
  jq -r --arg s "$step" --argjson i "$idx" --arg f "$f" \
    '.annotations[] | select(.step == $s and ((.index // 0) == $i))
     | "\($f)\t\(.step)#\(.index // "-")\t\(.copy)"' "docs/$f/annotations.json"
done
```

`--out .burn-check` keeps the burned images out of `docs/`. Gaps: the engine's `docsxai burn` does not forward `--max-overlap` (`cli-commands-docpack.ts:60-90,113-122`), so a non-default ratio needs `docsxai-viewer burn`. A variant that halts writes no `annotations.json`, so it has no entry in the report.

Evidence is by reading plus `packages/viewer/test/burn-report.test.ts`.

## 10. Do `es-ES` variants send `Accept-Language`?

Expected yes, by Playwright's documented behaviour. docsxai tests the first half of the chain and not the header.

The chain:

1. `matrix.locales` entry becomes `environment.locale` for the variant (`flow-matrix.ts:229-239`, used at `:273`).
2. `run` passes `flow.environment` to `launchPlaywrightSession` (`packages/engine/src/run-flows.ts:96-104`), one browser session per variant.
3. `environmentContextOptions` maps it to the context option `locale` (`playwright-driver.ts:107-119`), and `browser.newContext({...})` receives it (`:188-195`). Nothing after it sets `extraHTTPHeaders` for a run, and `run-flows.ts` passes no `contextOptions`.
4. Playwright's own type docs for `locale` (`playwright-core@1.63.0`, the version the engine pins as `^1.63.0`): "Locale will affect `navigator.language` value, `Accept-Language` request header value as well as number and date formatting rules."

Tested:

- `packages/engine/test/playwright-driver.test.ts:274-310`: a real Chromium session with `environment.locale: "en-GB"` reports `navigator.language === "en-GB"` (skipped when no Chromium is installed).
- `packages/engine/test/keystone-matrix.test.ts`: the matrix reaches the context, so viewport size and `prefers-color-scheme` differ per variant, and `copy_by_locale` picks the right text. It does not read `Accept-Language`.

Read only: that the browser sends `Accept-Language` on every request, including the document request. No test in the repository asserts the header, and I did not run one. The page also has to choose its language from that header. If trackxai's account, tokens and consent pages read a cookie or a stored preference set at sign-in, the `es-ES` variants stay English.

A check that costs one step per flow, using the `account` page (Spanish text). Add to `screens.flow.yaml`:

```yaml
- id: account-es-text
  action: wait
  only: { locale: [es] }
  success:
    text_contains: { selector: $account_title, text: <the Spanish title> }
```

It halts the `es-ES` variants if the page renders English (`success` checks halt the flow, `flow-runtime.ts:367`), and writes no screenshot (no annotation). The step id `account-es-text` is a placeholder; put the real Spanish heading text in `text`.
