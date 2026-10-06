# Screenshot pack: decision note

Two consumers each built their own copy of the same pipeline (burn, optimise, hash, manifest, drift check): `workspaces/trackxai-docs/scripts/build-screens.mjs` (`docsxai/screens-pack@1`) and remotxai's `website/scripts/screens/` (`docsxai/screens-manifest@1`). This note records what the product feature, `docsxai pack` and `docsxai drift`, takes from each and what it drops.

## One schema: `docsxai/screens-pack@2`

```
{ schema, generated_for?, flows: { <flow>: { title?: {<locale>: text},
    steps: { <step>: { caption?: {<locale>: text}, alt: {<locale>: text},
      variants: { "<locale>.<theme>.<viewport>": { src, width, height, bytes,
        callouts: [{ index, copy, bbox? }] } } } } } } }
```

- Superset of both shapes. From `screens-pack@1`: `bytes`, string callouts become `{ index, copy }`. From `screens-manifest@1`: flows, steps, localised caption and alt, bbox. `annotations` is renamed `callouts` so the key says what the reader sees.
- Locale, theme and viewport are not enumerated. Locale is a BCP 47 style tag (`^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$`), theme is `^[a-z][a-z0-9-]{0,23}$`, viewport is a 3 or 4 digit integer. Flow and step ids are `^[a-z0-9]+([-_][a-z0-9]+)*$`, at most 64 characters, no dots (the hash sits between two dots in the file name).
- `alt` must carry every locale a variant uses. `caption` and `title` are optional and unchecked for coverage.
- Files are `<public-prefix>/<flow>/<step>.<hash8>.png`, hash8 is the first 8 hex digits of the sha256 of the final bytes (after optimise). Default prefix `/screens`.
- Canonical text: keys sorted deeply, arrays in index order, two-space indent, trailing newline, no timestamps. Unknown keys are validation errors, so a timestamp cannot slip in.
- The validator is pure and lives in the viewer (`pack-validate.ts`). Converters (`pack-convert.ts`) are pure too. The `screens-pack@1` converter returns file moves, because v1 keyed files by the capture flow and v2 keys them by the logical flow. The `screens-manifest@1` converter takes a `bytesOf(src)` callback, since that shape never stored byte sizes.

## Where the logic lives

The viewer owns it (`packages/viewer/src/pack-*.ts`), next to `burnAnnotations`, which it reuses unchanged: obstacles, placement and the dark-connector outline all apply as they do for `burn`. The engine only routes `pack` and `drift` to the viewer bin through the existing `runViewerBin`, as it does for `burn`, and never imports the viewer. The `docsxai` meta package needs no change: its bin already points `DOCSX_VIEWER_BIN` at the viewer it depends on.

## Inputs

- Raw capture directory (remotxai shape): `<root>/<flow>/<step>/<locale>.<theme>.<viewport>.png` with a `.json` sidecar (`width`, `height`, `annotations[]`), `step.json` (`alt`, `caption?`) and `flow.json` (`title?`).
- Workspace (trackxai shape): `<ws>/docs/<capture-flow>/screenshots/<step>.png` and `annotations.json`, plus `<ws>/pack.json` (`docsxai/pack-config@1`) mapping each capture flow to a logical flow and a variant key and carrying alt text. A workspace that has `docs/` is read as one; `--from-raw` forces the raw reader. Clean screenshots are burned in memory, so `docs/<flow>/burned/` is not needed.

## Optimise and hash

Burn, then `oxipng -o 4 --strip safe` (lossless) if the binary is found (`DOCSX_OXIPNG_BIN`, else `oxipng` on PATH). Missing binary fails with a one-line `brew install oxipng` hint unless `--no-optimise`. The optimiser's output is verified (complete PNG, same pixels as the input) before it is trusted, so a shim or a broken binary fails the build instead of being hashed. A new `oxipng` version can change every hash. The hash is taken from the bytes that get written, so a committed file name proves its content. Output dimensions are checked against the capture.

## Writing and pruning

Files are written only when the bytes differ. Stale files are removed by exact path: the paths listed in the manifest already in `<out>`, minus the ones in the new manifest. The directory is never scanned, so unrelated files in it stay. Any of the three manifest shapes is read for this. An emptied flow directory is removed with a non-recursive `rmdir`.

## Guards

Run on title, caption, alt and callout copy before anything is written: loopback hosts (`localhost`, `127.x.x.x`, `::1`, `0.0.0.0`), private-network addresses (10/8, 172.16/12, 192.168/16, 169.254/16), email addresses outside the reserved example domains, `Authorization:` headers that are not `Bearer`, tokens in URL queries and obvious secrets (private key blocks, JWTs, bearer tokens, `sk-`, `ghp_`, AWS and Slack key shapes, `password=` style assignments). A failure names the manifest path and the rule, never the matched text.

## Drift

`docsxai drift <ws-or-raw> --against <pack dir> [--threshold pct]` rebuilds in memory without optimising and compares to the committed pack. Equal hash8 is unchanged. Otherwise both PNGs are decoded and compared pixel by pixel: changed pixels over the full area (4 decimals), bounding box of the changed region. A pixel-identical rebuild whose bytes differ (optimiser) passes. Fails on: a change over the threshold (default 0.5), a resize, a new variant, a missing variant, a committed file that does not match its hash. Exit 1 on any of those, 2 on bad arguments. The report has no timestamps and is sorted.

Pixels are decoded through resvg (already a viewer dependency, same path the burner uses for connector contrast), so the viewer gains no PNG library. Transparent pixels compare as white.

## Not decided here

The plugin (`packages/plugin`) gets no `pack` command yet. Locale-aware alt text generation stays with the host agent.
