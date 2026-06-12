---
title: Writing plugins
description: Extend the engine through the workspace plugin runtime - publishers, renderers, lint-rules, and auth strategies.
---

The engine's plugin runtime exposes four extension points: publishers,
renderers, lint-rules, and auth-strategies. A plugin is an npm package with a
`docsxai` manifest in its `package.json` and a `register(api)` module. Names
are namespaced (`<namespace>:<name>`), capabilities such as
`egress:<host-glob>` are declared up front and subset-checked against the
workspace's `plugin_capabilities`, and `plugins-lock.json` pins each plugin's
hash before any register module is imported.

The two first-party examples to crib from are
[plugin-confluence](/packages/plugin-confluence/) (a publisher) and
[plugin-starlight](/packages/plugin-starlight/) (a renderer).
