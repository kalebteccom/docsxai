# docsxai

The batteries-included install of [docsxai](https://github.com/kalebteccom/docsxai) — deterministic screenshot docs for web apps.

```sh
pnpm add -g docsxai@next   # or: npm install -g docsxai@next
docsxai --help
```

`next` is the 0.3.x line (`pack`, `--verify-determinism`, matrix flows); `latest` stays 0.2.0 until 0.3.x ships stable, then it moves and the pin should move to the stable version.

One global install gives you the whole CLI surface. This package is a thin meta-package: its bin resolves [`@docsxai/engine`](https://www.npmjs.com/package/@docsxai/engine)'s CLI entry and runs it in-process, and it depends on [`@docsxai/viewer`](https://www.npmjs.com/package/@docsxai/viewer) so the `docsxai-viewer` bin lands on your path too — `docsxai render`, `docsxai burn`, `docsxai pack` and `docsxai pack --check` work out of the box (`pack` also wants the external `oxipng` binary unless you pass `--no-optimise`). The bin points `DOCSX_VIEWER_BIN` at the viewer this package resolves when you haven't set it; with it set (or in the engine alone) the engine locates the viewer through its layered resolution: `DOCSX_VIEWER_BIN`, the installed `@docsxai/viewer` package, then PATH.

Chromium is a one-shot explicit install — never an install-time lifecycle script:

```sh
npx playwright-core install chromium
```

## Which package do I want?

- **`docsxai`** (this package) — you want the CLI: `init`, `capture-auth`, `calibrate`, `run`, `render`, `lint`, `diff`, `doctor`, … One install, everything wired.
- **`@docsxai/engine`** — you want the library (flow-file parser, deterministic runtime, exporters, backend client) as a dependency. This package re-exports the engine's library surface (`import { parseFlowFile } from "docsxai"` works), but depending on the engine directly keeps your tree minimal and skips the viewer.

Docs: <https://docsxai.dev> · Source + issues: <https://github.com/kalebteccom/docsxai>
