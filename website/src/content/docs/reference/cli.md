---
title: CLI
description: Every site-docs command - init, run, render, capture-auth, lint, diagnose, flow-tree, style, inspect, export, zip, push, pull, plugins.
---

The engine ships one binary, `site-docs`. The deterministic core commands are
`init` (scaffold a workspace), `run` (replay flows against the running app),
`render` (overlay annotations into the viewer), and `capture-auth` (cache a
logged-in session). Around them sit the calibration aids `lint`, `diagnose`,
`flow-tree`, `style`, and `inspect`, the publishing commands `export`, `zip`,
`push`, and `pull`, and `plugins list|info|sync` for the plugin runtime.

This page will grow into the full per-command reference with flags and
examples; until then `site-docs <command> --help` is authoritative.
