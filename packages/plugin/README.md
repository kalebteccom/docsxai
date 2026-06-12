# @docsxai/plugin — Claude Code plugin

The first-class invocation surface for the docsxai engine. Install globally:

```
claude plugin install https://github.com/kalebteccom/docsxai   # (the plugin lives under packages/plugin)
```

## Commands (deterministic — thin wrappers over the `docsxai` CLI)

| Command                         | What                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `/docsxai:run <project-dir>`    | Re-run flow-files headlessly, refresh `annotations.json` + screenshots. |
| `/docsxai:render <project-dir>` | Build the interactive viewer.                                           |
| `/docsxai:push <project-dir>`   | Upload the doc pack to the configured backend.                          |
| `/docsxai:pull <project-dir>`   | Download the doc pack from the configured backend.                      |
| `/docsxai:login`                | OAuth login to the backend (CI uses `DOCSX_TOKEN`).                     |

## Skills (calibration — agent-driven; the host supplies inference)

| Skill       | What                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `calibrate` | Drive a calibration end-to-end: discovery → mapping+testing → commit, producing a doc pack.       |
| `diagnose`  | The explicit failure path — propose a recalibration diff when a deterministic run halts on drift. |

## MCP

The skills shell out to the `docsxai` CLI and use the externally-provided **Claude in Chrome** MCP for
the discovery stage's live-browser driving. An internal MCP server (engine operations the calibration
skills call — parse-flow-file, run-flow, apply-ambiguity-resolution, …) is a possible future addition if
shelling out becomes the bottleneck.
