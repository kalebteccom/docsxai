---
title: Installation
description: Install the docsxai engine and viewer from npm or from source, fetch the Chromium runtime the engine drives, and verify the docsxai CLI works.
---

docsxai needs [Node.js 26 or newer](https://nodejs.org/) (check with `node --version`) and a
Chromium binary. Everything else is plain npm packages.

## From npm

One global install of the bare `docsxai` package gives you the whole CLI:

```sh
npm install -g docsxai@next
```

`pnpm add -g docsxai@next` works too. Run `pnpm setup` once first, or pnpm has no global bin
directory on your PATH.

`next` is the 0.3.x line, currently `0.3.0-rc.3` (`pack`, `--verify-determinism`, matrix flows).
`latest` is 0.2.0 and has none of those. It moves when 0.3.x ships stable, and then the pin should
move to the stable version.

`docsxai` is the batteries-included meta-package - its bin runs
[`@docsxai/engine`](/packages/engine/)'s CLI in-process, and it depends on
[`@docsxai/viewer`](/packages/viewer/) so the `docsxai-viewer` bin (which
`docsxai render` spawns) lands on your path too. Render works out of the box.

Prefer granular installs? The scoped packages are the same code:

```sh
npm install -g @docsxai/engine@next @docsxai/viewer@next
```

Use `@docsxai/engine` directly when you want the engine as a _library_
dependency (flow-file parser, deterministic runtime, exporters) - the bare
package re-exports it, but depending on the engine keeps your tree minimal.

Playwright's Chromium is a separate download. It is never an install-time
lifecycle script, so you run it once yourself:

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
docsxai doctor
```

`doctor` checks the Node version, Chromium, viewer resolution and more. Every
failing row prints its own one-line fix. Outside a workspace it skips the
workspace rows, which is fine for now.

`docsxai --help` prints the usage block listing `init`, `run`, `render`,
`capture-auth`, and the rest of the surface in the
[CLI reference](/reference/cli/). If `run` later complains that no Chromium
binary is found, the fix is the same one-time install:
`npx playwright-core install chromium` (from a source checkout:
`pnpm -C packages/engine exec playwright-core install chromium`).

Next: the [Quickstart](/getting-started/quickstart/).
