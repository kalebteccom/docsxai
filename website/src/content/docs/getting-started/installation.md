---
title: Installation
description: Install the docsxai engine and viewer from npm or from source, fetch the Chromium runtime the engine drives, and verify the docsxai CLI works.
---

docsxai needs [Node.js 26 or newer](https://nodejs.org/) and a Chromium binary. Everything else is
plain npm packages.

## From npm

One global install of the bare `docsxai` package gives you the whole CLI:

```sh
pnpm add -g docsxai
```

`docsxai` is the batteries-included meta-package - its bin runs
[`@docsxai/engine`](/packages/engine/)'s CLI in-process, and it depends on
[`@docsxai/viewer`](/packages/viewer/) so the `docsxai-viewer` bin (which
`docsxai render` spawns) lands on your path too. Render works out of the box.

Prefer granular installs? The scoped packages are the same code:

```sh
pnpm add -g @docsxai/engine @docsxai/viewer
```

Use `@docsxai/engine` directly when you want the engine as a _library_
dependency (flow-file parser, deterministic runtime, exporters) - the bare
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

Building from source is for contributors - see
[CONTRIBUTING.md](https://github.com/kalebteccom/docsxai/blob/main/CONTRIBUTING.md)
for the full workspace setup.

## Verify

```sh
docsxai --help
```

You should see the usage block listing `init`, `run`, `render`,
`capture-auth`, and the rest of the surface in the
[CLI reference](/reference/cli/). For a full environment health-check -
Node version, Chromium, viewer resolution, and more - run `docsxai doctor`;
every failing row prints its own one-line fix. If `run` later complains
that no Chromium binary is found, the fix is the same one-shot install:
`npx playwright-core install chromium` (from a source checkout:
`pnpm -C packages/engine exec playwright-core install chromium`).

Next: the [Quickstart](/getting-started/quickstart/).
