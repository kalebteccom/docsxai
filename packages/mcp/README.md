# @docsxai/mcp

Standalone **stdio MCP server** over the docsxai engine. It lets _any_ MCP-speaking host agent
(Claude Code, Codex, Cursor, a scripted client, …) drive the calibration workflow and introspect a
doc pack — without shelling out to the `docsxai` CLI. The tools wrap the same engine functions
the CLI wraps; behaviour is identical by construction.

## Boundary (load-bearing) — vs. browxai

This server exposes **calibration meta-orchestration + read-only doc-pack introspection only**.
It deliberately exposes **no browser primitives** — no click/fill/inspect on an arbitrary live
page. Live-page discovery during calibration is [browxai](../../docs/browxai-asks.md)'s surface;
docsxai-mcp orchestrates the deterministic engine around it. Keeping the two surfaces disjoint is
what keeps `docsxai run` agent-free and reproducible.

## Install / run

```sh
pnpm -r build           # the bin runs from dist/
node packages/mcp/dist/bin.js --workspace ~/docsxai/my-app
```

`--workspace <dir>` sets the default workspace for tool calls that omit the `workspace` argument;
every tool also accepts an explicit `workspace` per call. Logs go to stderr; stdout is the MCP
wire.

### Client config snippet

```json
{
  "mcpServers": {
    "docsxai": {
      "command": "docsxai-mcp",
      "args": ["--workspace", "/absolute/path/to/docsxai-workspace"]
    }
  }
}
```

(Or `"command": "node", "args": ["<repo>/packages/mcp/dist/bin.js", …]` when running from a
checkout.)

## Tools

| Tool                | Kind          | What it does                                                                                                                                                                                                                                                      |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_workspace`    | orchestration | Scaffold a new docsxai workspace (flows/, docs/, auth/strategy.yaml, `.docsxai.json`).                                                                                                                                                                            |
| `run_flows`         | orchestration | Deterministic execution: flow filter, `startFrom`/`stopAfter` prefix runs, CDP attach, bounded concurrency. Per-flow ok / halt cause / artifact paths. The merged flow's `environment` (frozen clock, locale, viewport, …) is passed into the Playwright session. |
| `render_viewer`     | orchestration | Build the static viewer by spawning the `docsxai-viewer` bin (engine's resolution order).                                                                                                                                                                         |
| `lint_flows`        | introspection | Static lint rules (R001–R004, …) plus plugin-contributed `extraRules` when the workspace's plugin set resolves.                                                                                                                                                   |
| `flow_tree`         | introspection | The `extends` graph: roots, descendants, orphans, resolution issues.                                                                                                                                                                                              |
| `diagnose_halt`     | orchestration | Halt context for one step + recommendations; optional live `actionable()` probe over CDP. Never edits the flow-file.                                                                                                                                              |
| `style_check`       | orchestration | Init/validate `docs/style.yaml`, rederive the JSON, scan write-ups for jargon leaks.                                                                                                                                                                              |
| `zip_pack`          | orchestration | Deterministic hand-off archive of the doc pack.                                                                                                                                                                                                                   |
| `push_pack`         | orchestration | Push the doc pack as a new backend revision (content-addressed screenshot blobs).                                                                                                                                                                                 |
| `pull_pack`         | orchestration | Pull a revision's artifacts back into the workspace files.                                                                                                                                                                                                        |
| `list_flows`        | introspection | Every flow's name, steps, `extends` parent, environment summary.                                                                                                                                                                                                  |
| `get_annotations`   | introspection | A flow's `annotations.json`, schema-validated.                                                                                                                                                                                                                    |
| `get_run_artifacts` | introspection | Artifact **paths only** (annotations, screenshots, halt shots, write-ups, viewer index).                                                                                                                                                                          |
| `plugins_list`      | introspection | Resolve + load the workspace's plugin set; status/trust/artifacts per plugin.                                                                                                                                                                                     |

Every result is structured JSON: `{ "ok": true, … }` on success, `{ "ok": false, "error": "…",
"hint": "…" }` on failure. `run_flows` reports per-flow `ok` so one halted flow doesn't mask the
others.

## Environment variables

| Var                | Used by                       | Meaning                                                              |
| ------------------ | ----------------------------- | -------------------------------------------------------------------- |
| `DOCSX_VIEWER_BIN` | `render_viewer`               | Explicit path to the viewer bin (overrides package/PATH resolution). |
| `DOCSX_TOKEN`      | `push_pack`, `pull_pack`      | Backend bearer token (when not using the OAuth token file).          |
| `DOCSX_*` creds    | `run_flows` (auth strategies) | Per-role credential env vars named in `auth/strategy.yaml`.          |

## Tests

`pnpm -C packages/mcp test`. The scripted-client suite drives the whole surface through an
in-process linked client/server pair (the SDK's `InMemoryTransport`) — a non-Claude MCP client as
the acceptance evidence. The `run_flows` rows run against the engine's toy-site fixture over real
Chromium and are skipped when no Chromium binary is installed
(`npx playwright install chromium`).

Adding a tool? Follow the numbered checklist in
[`docs/ai-context/tool-registration/mcp-tool-registry.md`](../../docs/ai-context/tool-registration/mcp-tool-registry.md).

## Deferred

Streamable-HTTP transport is deferred per the roadmap — stdio only for now. The package is
`private: true` until the go-public flip.
