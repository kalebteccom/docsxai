# docsxai

The batteries-included install of [docsxai](https://github.com/kalebteccom/docsxai) — deterministic screenshot docs for web apps.

Needs [Node 26+](https://nodejs.org/).

```sh
npm install -g docsxai@next   # or: pnpm add -g docsxai@next (run `pnpm setup` once first)
npx playwright-core install chromium
docsxai doctor
```

`next` is the 0.3.x line, currently `0.3.0-rc.3` (`pack`, `--verify-determinism`, matrix flows). `latest` is `0.2.0` and has none of those. It moves when 0.3.x ships stable, then the pin should move to the stable version. Chromium is a separate one-time download, never an install script. `docsxai doctor` checks Node, Chromium and the viewer and prints a fix for each failing row.

One global install gives you the whole CLI surface. This package is a thin meta-package: its bin resolves [`@docsxai/engine`](https://www.npmjs.com/package/@docsxai/engine)'s CLI entry and runs it in-process, and it depends on [`@docsxai/viewer`](https://www.npmjs.com/package/@docsxai/viewer) so the `docsxai-viewer` bin lands on your path too — `docsxai render`, `docsxai burn`, `docsxai pack` and `docsxai pack --check` work out of the box (`pack` also wants the external `oxipng` binary unless you pass `--no-optimise`). The bin points `DOCSX_VIEWER_BIN` at the viewer this package resolves when you haven't set it; with it set (or in the engine alone) the engine locates the viewer through its layered resolution: `DOCSX_VIEWER_BIN`, the installed `@docsxai/viewer` package, then PATH.

## Which package do I want?

- **`docsxai`** (this package) — you want the CLI: `init`, `capture-auth`, `calibrate`, `run`, `render`, `lint`, `diff`, `doctor`, … One install, everything wired.
- **`@docsxai/engine`** — you want the library (flow-file parser, deterministic runtime, exporters, backend client) as a dependency. This package re-exports the engine's library surface (`import { parseFlowFile } from "docsxai"` works), but depending on the engine directly keeps your tree minimal and skips the viewer.

First run: the [README walkthrough](https://github.com/kalebteccom/docsxai#first-run-in-10-minutes) or the [quickstart](https://docsxai.dev/getting-started/quickstart/). Docs: <https://docsxai.dev> · Source + issues: <https://github.com/kalebteccom/docsxai>
