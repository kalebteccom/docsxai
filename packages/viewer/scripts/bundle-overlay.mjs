// Bundles src/overlay-runtime.ts (plus its placement.ts import) into dist/generated/overlay.js:
// an unminified es2019 IIFE with no sourcemap, so the inlined page script stays auditable and the
// build is byte-deterministic. Runs as part of the package `build` script (and before `test`,
// since render.ts reads the bundle at runtime).

import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(pkgRoot, "src/overlay-runtime.ts")],
  outfile: resolve(pkgRoot, "dist/generated/overlay.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2019",
  minify: false,
  sourcemap: false,
  legalComments: "none",
});
