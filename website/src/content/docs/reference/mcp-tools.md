---
title: MCP tools
description: The fourteen tools the standalone docsxai-mcp server exposes - calibration meta-orchestration plus read-only doc-pack introspection for any MCP-speaking host - and the structured result contract they share.
---

`@docsxai/mcp` is a standalone MCP server over the engine (stdio, plus an
opt-in HTTP transport). It is repo-only: `private: true`, not on npm, so you run
it from a source checkout. It lets any MCP-speaking host agent (Claude Code, Codex, Cursor, a scripted
client) drive the calibration workflow and introspect a doc pack without
shelling out to the `docsxai` CLI - the tools wrap the same engine
functions the CLI wraps, so behaviour is identical by construction.

The boundary is load-bearing: this server exposes **calibration
meta-orchestration plus read-only doc-pack introspection only**. It
deliberately exposes no browser primitives - no click, fill, or inspect on an
arbitrary live page. Live-page discovery during calibration is
[browxai](/concepts/browxai-ecosystem/)'s surface; keeping the two disjoint
is what keeps `docsxai run` agent-free and reproducible.

## Running the server

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

`--workspace <dir>` sets the default workspace for tool calls that omit the
`workspace` argument; every tool also accepts an explicit `workspace` per
call. Logs go to stderr; stdout is the MCP wire.

## Over HTTP (opt-in, experimental)

stdio is the default. `docsxai-mcp serve --http --workspace-root <dir>` serves the same
fourteen tools at `/mcp` over Streamable HTTP, for a host that connects by URL. Nothing
is added or removed; the server enforces more around them:

- A bearer token is required. It comes from `DOCSX_MCP_TOKEN` or `--token-file`, never
  from an argument, and has to be at least 32 printable ASCII characters with at least 8
  distinct ones. A token file that group or other can read is refused on POSIX.
- It binds `127.0.0.1:8765`. A non-loopback `--host` needs `--allow-remote`, and the
  server speaks plain HTTP, so terminate TLS in front of it.
- Every path a tool receives has to resolve, symlinks included, inside
  `--workspace-root`, which is required.
- `run_flows` and `diagnose_halt` refuse `cdp`. `run_flows` refuses a `baseUrl` (or a
  workspace `app_url`) that is not an http(s) URL or whose host is, or resolves to, a
  link-local or cloud-metadata address (with `DOCSX_EGRESS_DENY_PRIVATE` on, a loopback
  or private one too), and the browser it starts gets the engine's request guard.
- `Host` and `Origin` are checked against an allow-list (403, before the token), and
  there are limits of 1 MiB per body, 16 sessions and 30 minutes idle.

The flags, the full list of checks and a client config are in the
[package page](/packages/mcp/).

## The tools

| Tool                | Kind          | What it does                                                                                                                                                                                                                                                   |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_workspace`    | orchestration | Scaffold a new docsxai workspace (`flows/`, `docs/`, `auth/strategy.yaml`, `.docsxai.json`).                                                                                                                                                                   |
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

The tools do not expand a flow's [`matrix`](/reference/flow-file/#matrix):
`run_flows` reports a flow that has one as failed, and `diagnose_halt` has no
`variant` argument. Use `docsxai run` and `docsxai diagnose --variant <id>` for those
flows.

## Worked examples

One call and result per tool family. Workspace paths are elided as `…`.

**Execution (`run_flows`).** A halted flow stays a per-flow result; the call
itself still succeeds:

```json
// call
{ "name": "run_flows", "arguments": { "flow": "publish-post" } }

// result
{
  "ok": true,
  "workspace": "…/docsxai/my-app",
  "allOk": false,
  "concurrency": 1,
  "flows": [
    {
      "flow": "publish-post",
      "ok": false,
      "haltStep": "publish",
      "haltCause": "target is covered by another element",
      "error": "[target is covered by another element] step \"publish\" (click) failed at https://localhost:3000/editor/draft-7: … (halt screenshot: docs/publish-post/halts/publish.png)"
    }
  ]
}
```

**Introspection (`list_flows`).** Read-only; never launches a browser:

```json
// call
{ "name": "list_flows", "arguments": {} }

// result
{
  "ok": true,
  "workspace": "…/docsxai/my-app",
  "flows": [
    {
      "name": "publish-post",
      "file": "flows/publish-post.flow.yaml",
      "extends": "login",
      "stepCount": 5,
      "steps": [
        { "id": "open-editor", "action": "click" },
        { "id": "write-draft", "action": "fill" },
        { "id": "publish", "action": "click" },
        { "id": "dismiss-confirm", "action": "click", "optional": true },
        { "id": "confirm-live", "action": "navigate" }
      ],
      "environment": { "viewport": "desktop", "clock": "2030-01-02T03:04:05Z" }
    }
  ]
}
```

**Diagnosis (`diagnose_halt`).** The same typed recommendations as
`docsxai diagnose --format json`; pass `cdp` for the live probe:

```json
// call
{
  "name": "diagnose_halt",
  "arguments": { "flow": "publish-post", "step": "publish", "cdp": "http://localhost:9222" }
}
```

**Failure shape.** Any tool that cannot proceed returns the error pair
instead of throwing:

```json
{
  "ok": false,
  "error": "no flow named \"publsh-post\"",
  "hint": "list_flows shows the available flow names"
}
```

## Environment variables

| Variable                    | Used by                       | Meaning                                                                       |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `DOCSX_VIEWER_BIN`          | `render_viewer`               | Explicit path to the viewer bin (overrides package/PATH resolution).          |
| `DOCSX_TOKEN`               | `push_pack`, `pull_pack`      | Backend bearer token (when not using the OAuth token file).                   |
| `DOCSX_MCP_TOKEN`           | `serve --http`                | Bearer token clients must send, at least 32 characters. Required.             |
| `DOCSX_EGRESS_GUARD`        | `run_flows` over HTTP         | On by default over HTTP; `0`, `false` or `no` switches the request guard off. |
| `DOCSX_EGRESS_DENY_PRIVATE` | `run_flows` over HTTP         | `1`, `true` or `yes` also refuses loopback and private-network hosts.         |
| `DOCSX_*` creds             | `run_flows` (auth strategies) | Per-role credential env vars named in `auth/strategy.yaml`.                   |

For install and test detail see the [package page](/packages/mcp/); for the
endpoints behind `push_pack` / `pull_pack` see the
[backend API](/reference/backend-api/).
