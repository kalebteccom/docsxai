#!/usr/bin/env node
// @kalebtec/docsxai-viewer — interactive docs-app generator.
//
// Library entry (re-exports `buildViewer`) and bin entry `docsxai-viewer`:
//   docsxai-viewer build <docs-dir> <out-dir> [--flow <name> ...]
// The plugin's `render` command (and `site-docs render`) shell out to this.

import { pathToFileURL } from "node:url";

export { buildViewer, type BuildViewerOptions, type BuildViewerResult } from "./render.js";
export {
  placeCallout,
  type Side,
  type Rect,
  type PlaceInput,
  type Placement,
} from "./placement.js";

import { buildViewer } from "./render.js";

const USAGE = `docsxai-viewer — static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...

  <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md)
  <out-dir>   where the generated viewer is written
`;

export async function runViewerCli(argv: string[]): Promise<number> {
  if (argv[0] !== "build") {
    process.stdout.write(USAGE + "\n");
    return argv.length === 0 ? 0 : 2;
  }
  const positional: string[] = [];
  const flows: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--flow" && argv[i + 1]) {
      flows.push(argv[i + 1]!);
      i++;
    } else positional.push(argv[i]!);
  }
  const [docsDir, outDir] = positional;
  if (!docsDir || !outDir) {
    process.stderr.write("build: requires <docs-dir> and <out-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  try {
    const r = await buildViewer({ docsDir, outDir, ...(flows.length ? { flows } : {}) });
    process.stdout.write(`viewer: wrote ${r.pages.length} page(s) to ${outDir}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`build: ${(e as Error).message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runViewerCli(process.argv.slice(2)).then((code) => process.exit(code));
}
