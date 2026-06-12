#!/usr/bin/env node
// `docsxai` — the batteries-included CLI (meta-package bin). Resolves @docsxai/engine's
// compiled CLI entry and runs it in-process (no child process). One global install of
// `docsxai` puts this bin *and* the viewer's `docsxai-viewer` bin on the path, so
// `docsxai render` works out of the box through the engine's layered viewer resolution.

const { main } = await import("@docsxai/engine/cli");
process.exit(await main(process.argv.slice(2)));
