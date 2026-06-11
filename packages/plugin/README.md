# @kalebtec/docsxai-plugin — Claude Code plugin

The first-class invocation surface for the site-docs engine. Install globally:

```
claude plugin install https://github.com/kalebteccom/docsxai   # (the plugin lives under packages/plugin)
```

## Commands (deterministic — thin wrappers over the `site-docs` CLI)

| Command                           | What                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `/site-docs:run <project-dir>`    | Re-run flow-files headlessly, refresh `annotations.json` + screenshots. |
| `/site-docs:render <project-dir>` | Build the interactive viewer.                                           |
| `/site-docs:push <project-dir>`   | Upload the doc pack to the configured backend.                          |
| `/site-docs:pull <project-dir>`   | Download the doc pack from the configured backend.                      |
| `/site-docs:login`                | OAuth login to the backend (CI uses `SITE_DOCS_TOKEN`).                 |

## Skills (calibration — agent-driven; the host supplies inference)

| Skill       | What                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `calibrate` | Drive a calibration end-to-end: discovery → mapping+testing → commit, producing a doc pack.       |
| `diagnose`  | The explicit failure path — propose a recalibration diff when a deterministic run halts on drift. |

## MCP

The skills shell out to the `site-docs` CLI and use the externally-provided **Claude in Chrome** MCP for
the discovery stage's live-browser driving. An internal MCP server (engine operations the calibration
skills call — parse-flow-file, run-flow, apply-ambiguity-resolution, …) is a possible future addition if
shelling out becomes the bottleneck.

Canonical spec/roadmap: the `project-ideas` portfolio, `projects/automated-site-documentation-bot/`.
