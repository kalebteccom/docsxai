---
title: Installation
description: Install the docsxai engine CLI, the Claude Code plugin, and the Chromium runtime it drives.
---

The engine ships the `site-docs` CLI:

```sh
pnpm add -g @kalebtec/docsxai-engine
```

Playwright's Chromium is installed explicitly as a one-shot, never as an
install-time lifecycle script:

```sh
npx playwright install chromium
```

Claude Code users can add the plugin, the first-class invocation surface for
calibration. Node.js 20 or newer is required.
