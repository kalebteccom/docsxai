---
title: Installation
description: Install the docsxai engine and viewer from npm or from source, fetch the Chromium runtime the engine drives, and verify the docsxai CLI works.
---

docsxai needs Node.js 20 or newer and a Chromium binary. Everything else is
plain npm packages.

## From npm

One global install of the bare `docsxai` package gives you the whole CLI:

```sh
pnpm add -g docsxai
```

`docsxai` is the batteries-included meta-package — its bin runs
[`@docsxai/engine`](/packages/engine/)'s CLI in-process, and it depends on
[`@docsxai/viewer`](/packages/viewer/) so the `docsxai-viewer` bin (which
`docsxai render` spawns) lands on your path too. Render works out of the box.

Prefer granular installs? The scoped packages are the same code:

```sh
pnpm add -g @docsxai/engine @docsxai/viewer
```

Use `@docsxai/engine` directly when you want the engine as a _library_
dependency (flow-file parser, deterministic runtime, exporters) — the bare
package re-exports it, but depending on the engine keeps your tree minimal.

Playwright's Chromium is installed explicitly as a one-shot, never as an
install-time lifecycle script:

```sh
npx playwright-core install chromium
```

Claude Code users can additionally install
[`@docsxai/plugin`](/packages/plugin/), the first-class invocation
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
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$(pwd)" > "$HOME/.local/bin/docsxai"
chmod +x "$HOME/.local/bin/docsxai"
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
docsxai --help
```

You should see the usage block listing `init`, `run`, `render`,
`capture-auth`, and the rest of the surface in the
[CLI reference](/reference/cli/). For a full environment health-check —
Node version, Chromium, viewer resolution, and more — run `docsxai doctor`;
every failing row prints its own one-line fix. If `run` later complains
that no Chromium binary is found, the fix is the same one-shot install:
`npx playwright-core install chromium` (from a source checkout:
`pnpm -C packages/engine exec playwright-core install chromium`).

Next: the [Quickstart](/getting-started/quickstart/).
