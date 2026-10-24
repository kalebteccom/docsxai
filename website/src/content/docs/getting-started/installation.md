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

`next` is the 0.3.x line, currently `0.3.0-rc.3` (`burn`, `pack`, `run --verify-determinism` and
matrix flows). `latest` is 0.2.0 and has none of those, so a plain `pnpm add -g docsxai` installs the
older release. To pin the prerelease, name the version: `pnpm add -g docsxai@0.3.0-rc.3`. When 0.3
ships stable, `latest` moves and the `@next` suffix is no longer needed.

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

## Claude Code plugin

Claude Code users can add the plugin, which brings the calibration skills and the `/docsxai:*`
commands. It installs from this repository's marketplace. Inside Claude Code:

```text
/plugin marketplace add kalebteccom/docsxai
/plugin install docsxai@docsxai
```

The CLI does not depend on the plugin, and every deterministic command works without it. The
[`@docsxai/plugin`](/packages/plugin/) page lists the commands and skills. To try a checkout
without installing, start Claude Code with `claude --plugin-dir /path/to/docsxai/packages/plugin`.

## From source

Building from source is for contributors - see
[CONTRIBUTING.md](https://github.com/kalebteccom/docsxai/blob/main/CONTRIBUTING.md)
for the full workspace setup.

## Verify

```sh
docsxai doctor
```

`doctor` checks the Node version, Chromium, viewer resolution and more. Each
line starts with `ok:` or `fail:`, and a `fail:` line names its fix after
`next:`. Outside a workspace it skips the workspace lines, which is fine for
now. The command exits 1 when any line fails.

`docsxai --help` prints the usage block listing `init`, `run`, `render`,
`capture-auth`, and the rest of the surface in the
[CLI reference](/reference/cli/). If `run` later complains that no Chromium
binary is found, the fix is the same one-time install:
`npx playwright-core install chromium` (from a source checkout:
`pnpm -C packages/engine exec playwright-core install chromium`).

Next: the [Quickstart](/getting-started/quickstart/).
