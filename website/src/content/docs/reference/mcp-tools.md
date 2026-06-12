---
title: MCP tools
description: The docsxai-mcp tool surface - calibration meta-orchestration and read-only doc-pack introspection for any MCP-speaking host.
---

`@kalebtec/docsxai-mcp` is a standalone stdio MCP server over the engine. It
exposes fourteen tools: `init_workspace`, `run_flows`, `render_viewer`,
`lint_flows`, `flow_tree`, `diagnose_halt`, `style_check`, `zip_pack`,
`push_pack`, `pull_pack`, `list_flows`, `get_annotations`,
`get_run_artifacts`, and `plugins_list`. Every result is structured as
`{ok, ...}` or `{ok: false, error, hint}`.

The server deliberately exposes no browser primitives; live-page discovery
during calibration is [browxai](/concepts/browxai-ecosystem/)'s surface. This
page will grow into the per-tool schema reference.
