# Design audit allowlist

Findings from a static design detector that are noise, with the evidence for each. Anything the detector reports that is not in this table gets fixed. `website/scripts/check-design-allowlist.test.mjs` fails if the table loses a column or an entry lacks a reason or evidence.

## How this list was made

- Tool: impeccable 4.7.0 (Apache-2.0), engine 0.1.16 (`@impeccable/cli-darwin-arm64`, `5c00c3130b961f3aa1066f04ed0e1f58e87808ad153efa00f1c44184800084f2`).
- Inputs: a copy of `website/dist` after `cd website && npm run build` (40 pages) and a copy of `website/src`.
- Re-run it in a scratch directory with `npm i --ignore-scripts impeccable@4.7.0`, a scratch `HOME` and `IMPECCABLE_HOME`, and a macOS sandbox profile that denies network and limits writes to that directory. Run only the static command: `impeccable detect --json <copy of dist>` and the same for `src`. Never run its `install` or hooks, and never let it write a PRODUCT or DESIGN file into the repo.
- Last run: 46 findings on the built site (38 `cramped-padding`, 8 `em-dash-overuse`, all listed below), 0 on `website/src`.

## Entries

| rule                         | count | reason                                                                                                        | evidence                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cramped-padding (`dropdown`) | 38    | Starlight's mobile "On this page" menu. The wrapper has no padding because each link carries the inset.       | A 390 px capture of `/concepts/architecture/` with the menu open: wrapper padding `0px`, every link `padding: 8px 16px` and 44 px tall. One finding per page that has the menu (38 of 40 pages).                                                                                                             |
| em-dash-overuse              | 8     | The detector counts a double hyphen as an em dash. The pages are the ones full of CLI flags such as `--auth`. | Per page, U+2014 count 0 and U+2013 count 0, `--` count equal to the finding count: quickstart 17, ci-recipes 63, themed-caption-packs 51, troubleshooting 20, engine 56, mcp 40, plugin 13, cli reference 399 (659 in total). `website/scripts/check-dashes.test.mjs` fails on a real em dash in site copy. |
