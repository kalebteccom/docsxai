#!/usr/bin/env node
// `docsxai` — the batteries-included CLI (meta-package bin). Resolves @docsxai/engine's
// compiled CLI entry and runs it in-process (no child process). One global install of
// `docsxai` puts this bin *and* the viewer's `docsxai-viewer` bin on the path, so
// `docsxai render` and `docsxai burn` work out of the box.
//
// The engine finds the viewer next to itself, which a nested layout (pnpm's virtual store, a
// workspace checkout) doesn't give it: the viewer is this package's dependency, not the engine's.
// So when the operator hasn't pointed DOCSX_VIEWER_BIN anywhere, point it at the copy this
// package resolves. An explicit value always wins.

import { fileURLToPath } from "node:url";

if (!process.env.DOCSX_VIEWER_BIN) {
  try {
    // The viewer's package entry is its bin script (`docsxai-viewer` → dist/index.js).
    process.env.DOCSX_VIEWER_BIN = fileURLToPath(import.meta.resolve("@docsxai/viewer"));
  } catch {
    // Not installed: the engine's own resolution (package, then PATH) reports what it tried.
  }
}

const { main, runAsBin } = await import("@docsxai/engine/cli");
process.exit(await runAsBin(main, process.argv.slice(2)));
