---
title: Architecture
description: How the engine, the Claude Code plugin, the MCP server, the backend, and the viewer fit together.
---

docsxai is a small family of packages around one deterministic core. The
engine owns the flow-file parser, the Playwright-backed runtime, the
calibration helpers (`lint`, `diagnose`, `flow-tree`, `style`), and the
target-site auth strategies. The Claude Code plugin and the standalone MCP
server are invocation surfaces over that engine; neither adds browser
primitives of its own. A small authenticated backend persists doc packs, and
the viewer renders them.

The split is deliberate: everything that executes is deterministic and
agent-free, and everything agent-facing orchestrates around it.
