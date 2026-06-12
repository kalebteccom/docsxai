---
title: MCP tools
description: The fourteen tools the standalone docsxai-mcp server exposes - calibration meta-orchestration plus read-only doc-pack introspection for any MCP-speaking host - and the structured result contract they share.
---

`@kalebtec/docsxai-mcp` is a standalone stdio MCP server over the engine. It
lets any MCP-speaking host agent (Claude Code, Codex, Cursor, a scripted
client) drive the calibration workflow and introspect a doc pack without
shelling out to the `site-docs` CLI - the tools wrap the same engine
functions the CLI wraps, so behaviour is identical by construction.

The boundary is load-bearing: this server exposes **calibration
meta-orchestration plus read-only doc-pack introspection only**. It
deliberately exposes no browser primitives - no click, fill, or inspect on an
arbitrary live page. Live-page discovery during calibration is
[browxai](/concepts/browxai-ecosystem/)'s surface; keeping the two disjoint
is what keeps `site-docs run` agent-free and reproducible.

## Running the server

```json
{
  "mcpServers": {
    "docsxai": {
      "command": "docsxai-mcp",
      "args": ["--workspace", "/absolute/path/to/site-docs-workspace"]
    }
  }
}
```

`--workspace <dir>` sets the default workspace for tool calls that omit the
`workspace` argument; every tool also accepts an explicit `workspace` per
call. Logs go to stderr; stdout is the MCP wire.

## The tools

| Tool                | Kind          | What it does                                                                                                                                                                                                                                                   |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_workspace`    | orchestration | Scaffold a new site-docs workspace (`flows/`, `docs/`, `auth/strategy.yaml`, `.site-docs.json`).                                                                                                                                                               |
| `run_flows`         | orchestration | Deterministic execution: flow filter, `startFrom`/`stopAfter` prefix runs, CDP attach, bounded concurrency. Per-flow ok / halt cause / artifact paths. The merged flow's `environment` (frozen clock, locale, viewport) is passed into the Playwright session. |
| `render_viewer`     | orchestration | Build the static viewer by spawning the `docsxai-viewer` bin (the engine's resolution order).                                                                                                                                                                  |
| `lint_flows`        | introspection | The static lint rules, plus plugin-contributed rules when the workspace's plugin set resolves.                                                                                                                                                                 |
| `flow_tree`         | introspection | The `extends` graph: roots, descendants, orphans, resolution issues.                                                                                                                                                                                           |
| `diagnose_halt`     | orchestration | Halt context for one step plus typed recommendations; optional live `actionable()` probe over CDP. Never edits the flow-file.                                                                                                                                  |
| `style_check`       | orchestration | Init or validate `docs/style.yaml`, rederive the JSON, scan write-ups for jargon leaks.                                                                                                                                                                        |
| `zip_pack`          | orchestration | Deterministic hand-off archive of the doc pack.                                                                                                                                                                                                                |
| `push_pack`         | orchestration | Push the doc pack as a new backend revision (content-addressed screenshot blobs).                                                                                                                                                                              |
| `pull_pack`         | orchestration | Pull a revision's artifacts back into the workspace files.                                                                                                                                                                                                     |
| `list_flows`        | introspection | Every flow's name, steps, `extends` parent, environment summary.                                                                                                                                                                                               |
| `get_annotations`   | introspection | A flow's `annotations.json`, schema-validated.                                                                                                                                                                                                                 |
| `get_run_artifacts` | introspection | Artifact **paths only** (annotations, screenshots, halt shots, write-ups, viewer index).                                                                                                                                                                       |
| `plugins_list`      | introspection | Resolve and load the workspace's plugin set; status, trust, and artifacts per plugin.                                                                                                                                                                          |

## The result contract

Every result is structured JSON: `{ "ok": true, ... }` on success,
`{ "ok": false, "error": "...", "hint": "..." }` on failure - the hint is the
agent-actionable next step. `run_flows` reports per-flow `ok`, so one halted
flow does not mask the others.

## Environment variables

| Variable               | Used by                       | Meaning                                                              |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `SITE_DOCS_VIEWER_BIN` | `render_viewer`               | Explicit path to the viewer bin (overrides package/PATH resolution). |
| `SITE_DOCS_TOKEN`      | `push_pack`, `pull_pack`      | Backend bearer token (when not using the OAuth token file).          |
| `SITE_DOCS_*` creds    | `run_flows` (auth strategies) | Per-role credential env vars named in `auth/strategy.yaml`.          |

For install and test detail see the [package page](/packages/mcp/); for the
endpoints behind `push_pack` / `pull_pack` see the
[backend API](/reference/backend-api/).
