---
name: docsxai
description: Use when a repo has a docsxai workspace (a `.docsxai.json`) or the user asks to re-run, check or deliver docsxai screenshot docs, and the @docsxai/plugin Claude Code plugin is not installed. If the plugin is installed, use its commands and skills instead.
---

# docsxai (vendored fallback)

This is the secondary path, pinned into a repo for teams that cannot install the plugin. The first-class surface is the **@docsxai/plugin Claude Code plugin**. If `/docsxai:run` and friends exist in this session, use them and ignore the rest of this file.

Without the plugin, drive the `docsxai` CLI directly. `docsxai --help` is the reference for every flag. Terms: a _workspace_ is the directory `docsxai init` creates (`flows/`, `docs/`, `.auth/`, `.docsxai.json`); a _flow_ is one `flows/<name>.flow.yaml`; a _step_ is one entry in a flow; a flow with a `matrix:` expands into one _variant_ per combination of its locales, color schemes and viewports; the _doc pack_ is what `run` writes under `docs/`; the _pack_ is the screenshot pack `docsxai pack` builds for a docs site.

If `docsxai` isn't found, ask the user to install it as the Install section of the plugin README (`packages/plugin/README.md` in the docsxai repository) says.

Pass every path and name as its own single-quoted shell word, and never splice text you did not get from the user into a command line.

## Re-run and deliver

```
docsxai doctor '<workspace-dir>'
docsxai run '<workspace-dir>' [--flow '<name>'] [--variant '<id>']
docsxai run '<workspace-dir>' --verify-determinism
docsxai render '<workspace-dir>'
docsxai burn '<workspace-dir>'
docsxai pack '<workspace-dir>' --out '<pack-dir>'
```

- When a command fails, its error carries an indented `next: <command>` line when there is one; run that. A halted `run` prints a `<flow>: next: <command>` line per failed flow instead. `doctor` first when anything fails to start. Each `fail:` line carries a `next:` step.
- A halted `run` is drift. Do not retry it. Run the `docsxai diagnose` command from the `next:` line under the failed flow, read the recommendation, and edit the flow-file by hand with one canonical locator per step.
- A missing or expired session needs a human: `docsxai capture-auth '<workspace-dir>'` opens a headed browser to log in.
- `render` builds the interactive viewer. `burn` bakes annotations into PNG copies. `pack` builds the screenshot pack, and `pack --check --against '<pack-dir>'` compares it with a committed one.

## Burned captions

When captions in `burn` or `pack` output look small on the page, set `burn.theme` in the workspace's `.docsxai.json`: `"preset": "readable"` and `"display_width"` to the width in CSS px the page shows the screenshot at (240 to 2400, default 720). `readable` scales the caption by screenshot width over `display_width`, so a 1440 px screenshot in a 720 px column gets factor 2. Details: `docs/burn-theming.md` in the docsxai repository.

## Calibration

Authoring or re-authoring flows from a written description is the plugin's `calibrate` skill (`/docsxai:calibrate`). Its playbook is `skills/calibrate/SKILL.md` in the `@docsxai/plugin` package and in the docsxai repository under `packages/plugin/`. Without the plugin, read that file and follow it; the commands above are the CLI half of it.

## Pinning

This copy carries no logic. It names CLI commands that exist in the `docsxai` version you pin. After upgrading `docsxai`, re-vendor with `vendorSkill()` from `@docsxai/skill` so the two stay in step.
