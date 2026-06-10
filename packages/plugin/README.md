# @kalebtec/docsxai-plugin — Claude Code plugin

The first-class invocation surface for the site-docs engine. Install globally:

```
claude plugin install https://github.com/kalebteccom/docsxai   # (the plugin lives under packages/plugin)
```

## Commands (deterministic — thin wrappers over the `site-docs` CLI)

| Command | What |
|---|---|
| `/site-docs:run <project-dir>` | Re-run flow-files headlessly, refresh `annotations.json` + screenshots. |
| `/site-docs:render <project-dir>` | Build the interactive viewer. |
| `/site-docs:login` | OAuth login to the backend (CI uses `SITE_DOCS_TOKEN`). |
| `publish` / `edit` / `push` / `pull` | TODO — Phase-1 build. |

## Skills (calibration — agent-driven; the host supplies inference)

| Skill | What |
|---|---|
| `calibrate` | Drive a calibration end-to-end: discovery → mapping+testing → commit, producing a doc pack. |
| `diagnose` | The explicit failure path — propose a recalibration diff when a deterministic run halts on drift. |
| `style-learn` / `translate` | TODO — Phase-1 build. |

## MCP

An internal MCP server (engine operations the calibration skills call — parse-flow-file, run-flow,
apply-ambiguity-resolution, …) is a Phase-0/1 TODO. For now the skills use the `site-docs` CLI plus the
externally-provided **Claude in Chrome** MCP for the discovery stage's live-browser driving.

> **Manifest note:** `.claude-plugin/plugin.json` here is a plausible scaffold; the exact schema +
> command/skill discovery rules need validating against current Claude Code plugin docs (the Phase-0
> "plugin packaging prototype" item).

Canonical spec/roadmap: the `project-ideas` portfolio, `projects/automated-site-documentation-bot/`.
