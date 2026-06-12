---
title: Plugins
description: The workspace plugin runtime surface - the docsxai manifest, namespacing, capability declarations, and plugins-lock.json pinning.
---

Plugins extend the engine at four points: publishers, renderers, lint-rules,
and auth-strategies. A plugin declares a `docsxai` manifest on its
`package.json` and exports a `register(api)` module. Contributions are
namespace-prefixed (`<namespace>:<name>`; `site-docs`, `docsxai`, `core`, and
`plugins` are reserved), load order respects `dependsOn` with cycle rejection,
and capability declarations such as `egress:<host-glob>` are subset-checked
against the workspace's `plugin_capabilities`. `plugins-lock.json` pins each
plugin by sha256, verified before any plugin code executes.

Authoring guidance lives in [Writing plugins](/guides/writing-plugins/); this
page will grow into the full runtime API reference.
