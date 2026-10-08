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

## Commands (deterministic, thin wrappers over the `docsxai` CLI)

Each command passes its arguments to the CLI as single-quoted shell words. The CLI's own usage line and `--help` are the reference for every flag.

| Command                                               | What                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/docsxai:run <workspace-dir>`                        | Re-run the flows headlessly, refresh `annotations.json` and screenshots. `--variant` and `--verify-determinism` pass through. |
| `/docsxai:render <workspace-dir>`                     | Build the interactive viewer.                                                                                                 |
| `/docsxai:push <workspace-dir>`                       | Upload the doc pack to the configured backend.                                                                                |
| `/docsxai:pull <workspace-dir>`                       | Download the doc pack from the configured backend.                                                                            |
| `/docsxai:login`                                      | Backend login: `--oauth` runs OAuth 2.1 + PKCE, CI uses `DOCSX_TOKEN`.                                                        |
| `/docsxai:doctor [<workspace-dir>]`                   | Environment and workspace health-check (✓/✗ plus a one-line fix per failure).                                                 |
| `/docsxai:plugins <list\|info\|sync> <workspace-dir>` | List, inspect, and sync (lock) the workspace's plugins.                                                                       |
| `/docsxai:export <adf\|playwright> <workspace-dir>`   | Export the doc pack as a Confluence ADF projection, or as Playwright specs.                                                   |

The rest of the CLI has no slash command: `init`, `capture-auth`, `calibrate`, `inspect`, `lint`, `flow-tree`, `diagnose`, `style`, `zip`, `baseline`, `diff`, `burn` (annotations baked into PNG copies), and `pack` (the screenshot pack a docs site ships, with `pack --check`). Skills and agents call them through the shell; run `docsxai --help` for the flags.

## Skills (calibration, agent-driven; the host supplies inference)

| Skill       | What                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `calibrate` | Drive a calibration end-to-end: discovery → mapping+testing → commit, producing a doc pack.      |
| `diagnose`  | The explicit failure path: propose a recalibration diff when a deterministic run halts on drift. |

Invoke them as `/docsxai:calibrate` and `/docsxai:diagnose`, or let the agent load one when the request matches its description.

## MCP

The plugin registers no MCP server. The skills shell out to the `docsxai` CLI and use the
externally-provided **browxai** MCP (any MCP browser bridge works) for the discovery stage's live-browser
driving. Hosts that prefer MCP tools over shell-outs can register the standalone `@docsxai/mcp` server
(engine operations as tools: `run_flows`, `lint_flows`, `diagnose_halt`, …; repo-only, see its README).
