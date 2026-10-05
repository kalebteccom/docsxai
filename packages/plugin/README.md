# @docsxai/plugin — Claude Code plugin

The first-class invocation surface for the docsxai engine.

## Install

From inside Claude Code, add the marketplace this repo publishes (`.claude-plugin/marketplace.json` at the repo root, marketplace name `docsxai`) and install the plugin:

```
/plugin marketplace add kalebteccom/docsxai
/plugin install docsxai@docsxai
```

The same from a shell:

```
claude plugin marketplace add kalebteccom/docsxai
claude plugin install docsxai@docsxai
```

The marketplace entry points at `./packages/plugin`, which holds `.claude-plugin/plugin.json`. Both manifests pass `claude plugin validate`.

**Verified:** adding a local checkout as a marketplace (`claude plugin marketplace add /path/to/docsxai`) and installing `docsxai@docsxai` from it, in an isolated Claude Code config directory. **Unverified:** the `kalebteccom/docsxai` GitHub shorthand, which resolves only once the manifest is on the default branch.

### Local development

Load the plugin straight from a checkout, with no marketplace:

```
claude --plugin-dir /path/to/docsxai/packages/plugin
```

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
