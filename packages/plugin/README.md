# @docsxai/plugin — Claude Code plugin

The first-class invocation surface for the docsxai engine.

## Install

The plugin directory (`packages/plugin/`, with `.claude-plugin/plugin.json`) passes `claude plugin validate`. Load it from a checkout:

```
claude --plugin-dir /path/to/docsxai/packages/plugin
```

**Unverified:** installing straight from the GitHub URL (`claude plugin install https://github.com/kalebteccom/docsxai`) is not a documented install form, and this repo ships no `.claude-plugin/marketplace.json`. Claude Code's documented install path is `claude plugin install <plugin>@<marketplace>` from a registered marketplace, where a marketplace entry can point at a subdirectory with a relative `source` or a `git-subdir` source. Whether that works for this monorepo subdirectory has not been tested here, because no marketplace exists yet.

## Commands (deterministic — thin wrappers over the `docsxai` CLI)

| Command                         | What                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `/docsxai:run <project-dir>`    | Re-run flow-files headlessly, refresh `annotations.json` + screenshots. |
| `/docsxai:render <project-dir>` | Build the interactive viewer.                                           |
| `/docsxai:push <project-dir>`   | Upload the doc pack to the configured backend.                          |
| `/docsxai:pull <project-dir>`   | Download the doc pack from the configured backend.                      |
| `/docsxai:login`                | Backend login: `--oauth` runs OAuth 2.1 + PKCE; CI uses `DOCSX_TOKEN`.  |
| `/docsxai:doctor`               | Environment + workspace health-check (✓/✗ + one-line fixes).            |
| `/docsxai:plugins`              | List, inspect, and lock the workspace's plugins.                        |
| `/docsxai:export`               | Export the doc pack as a wiki-ready ADF projection.                     |

## Skills (calibration — agent-driven; the host supplies inference)

| Skill       | What                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `calibrate` | Drive a calibration end-to-end: discovery → mapping+testing → commit, producing a doc pack.       |
| `diagnose`  | The explicit failure path — propose a recalibration diff when a deterministic run halts on drift. |

## MCP

The plugin registers no MCP server. The skills shell out to the `docsxai` CLI and use the
externally-provided **browxai** MCP (any MCP browser bridge works) for the discovery stage's live-browser
driving. Hosts that prefer MCP tools over shell-outs can register the standalone `@docsxai/mcp` server
(engine operations as tools: `run_flows`, `lint_flows`, `diagnose_halt`, …; repo-only, see its README).
