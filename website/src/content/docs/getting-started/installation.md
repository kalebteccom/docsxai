---
title: Installation
description: Install the docsxai engine and viewer from npm or from source, fetch the Chromium runtime the engine drives, and verify the site-docs CLI works.
---

docsxai needs Node.js 20 or newer and a Chromium binary. Everything else is
plain npm packages.

## From npm

The engine ships the `site-docs` CLI; the viewer ships the `docsxai-viewer`
bin that `site-docs render` spawns. Install both:

```sh
pnpm add -g @kalebtec/docsxai-engine @kalebtec/docsxai-viewer
```

Playwright's Chromium is installed explicitly as a one-shot, never as an
install-time lifecycle script:

```sh
npx playwright install chromium
```

Claude Code users can additionally install
[`@kalebtec/docsxai-plugin`](/packages/plugin/), the first-class invocation
surface for agent-driven calibration. The CLI does not depend on it; every
deterministic command works standalone.

## From source

Clone the repo and build the workspace. The repo uses pnpm via Corepack, so
`corepack enable` is the only setup:

```sh
git clone https://github.com/kalebteccom/docsxai
cd docsxai
corepack enable          # provides pnpm
pnpm install
pnpm -C packages/engine exec playwright-core install chromium
pnpm -r build
```

The CLI binary lands at `packages/engine/dist/cli.js`. Two ways to put it on
`PATH`:

```sh
# Option A - wrapper scripts (sidesteps pnpm-global-store quirks):
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$(pwd)" > "$HOME/.local/bin/site-docs"
chmod +x "$HOME/.local/bin/site-docs"
export PATH="$HOME/.local/bin:$PATH"

# Option B - pnpm global link (when the store is consistent):
pnpm -C packages/engine link --global
```

The wrapper-script route is the robust one: pnpm global links break with
`ERR_PNPM_UNEXPECTED_STORE` on long-lived machines, and the wrapper sidesteps
that entirely. Add a matching `docsxai-viewer` wrapper pointing at
`packages/viewer/dist/index.js` if you build the viewer from source too.

## Verify

```sh
site-docs --help
```

You should see the usage block listing `init`, `run`, `render`,
`capture-auth`, and the rest of the surface in the
[CLI reference](/reference/cli/). If `run` later complains that no Chromium
binary is found, the fix is the same one-shot install:
`npx playwright install chromium`.

Next: the [Quickstart](/getting-started/quickstart/).
