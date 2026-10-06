---
title: Determinism and drift
description: Check that docsxai run writes the same bytes twice with --verify-determinism, read the report, fix what varies, and gate a nightly job on drift against a committed baseline.
---

`docsxai run` promises the same doc pack for the same flows and the same target state. Two
checks hold that promise to account. `--verify-determinism` asks whether two runs against the same
target agree. `docsxai diff` asks whether today's run still matches the baseline you committed.
Run them in that order: a diff against a doc pack that changes on every run only shows noise.

## Check one run against another

```sh
docsxai run ./docs-workspace --verify-determinism
```

The command runs the selected flows twice (`--runs 5` for up to five), each into its own folder under
`docs-workspace/.docsxai-verify/`, then compares every file: `annotations.json`, the screenshots, the
step markdown, the locators and the halt context. Exit 0 means every file is byte-identical. Exit 1
means a file differs or a flow halted. Exit 2 means the flags were wrong.

The workspace is only written when all runs agree. In that case run 1's files are copied in, the
same bytes a plain `run` writes. If anything differs, the workspace stays as it was, so a failed
check never leaves a half-updated doc pack. The `.docsxai-verify/` folders are removed when the
command ends.

## Read the report

The report names the first differing artefact by path, with a cause:

```
result: DIFFERING
first differing artefact: docs/publish-post/screenshots/publish.png (run 2 vs run 1)
  cause: 31 pixels differ (0.0034%) inside x=412 y=88 52x12
```

| Artefact | Cause shown                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| PNG      | changed-pixel count and bounding box, or the two image sizes                  |
| JSON     | the key path of the first difference, such as `annotations[0].bounding_box.x` |
| Text     | the first differing line                                                      |
| Other    | the two sizes, or the offset of the first differing byte                      |

`--format md` writes the same report as a markdown section for a job summary or an artifact, and
`--format json` writes it for tooling. The report holds no timestamps or paths, so the same runs
give the same bytes.

## Fix what varies

The bounding box says where to look. A box around a time or a counter points at a clock: set
`environment.clock` in the flow. A box around an animated or lazy-loaded element points at timing:
use `wait_for: settled` or `environment.reduced_motion`. A box around content that changes per
visit, such as a rotating banner or a random avatar, calls for a `hide` step or a redaction. See the
[flow-file reference](/reference/flow-file/) for each field.

:::caution[For agents]
Running the check again does not fix a determinism failure. Read the cause line, change the flow,
then run `--verify-determinism` again. Do not raise the `diff` thresholds or add
`ignore_regions` to get past it: that hides the variation without removing it.
:::

## Gate a nightly job

A nightly job runs both checks and keeps the reports as an artifact. Copy-paste versions for GitHub
Actions, GitLab CI and Woodpecker are in the [CI recipes](/guides/ci-recipes/#nightly-drift-jobs), and
runnable copies sit in `examples/ci/` in the repository.

Browser capture does not belong in per-PR pipelines on shared runners. It launches Chromium, walks
the whole app and needs target credentials, so schedule it on a runner you control.
