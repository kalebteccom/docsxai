#!/usr/bin/env node
// @kalebtec/docsxai-viewer — interactive docs-app generator + burned-annotation renderer.
//
// Library entry (re-exports `buildViewer`, `burnAnnotations`, `burnFlow`) and bin entry
// `docsxai-viewer`:
//   docsxai-viewer build <docs-dir> <out-dir> [--flow <name> ...]
//   docsxai-viewer burn <workspace> [--flow <name> ...] [--out <dir>]
// The plugin's `render` command (and `site-docs render`) shell out to `build`.

import * as path from "node:path";
import { pathToFileURL } from "node:url";

export {
  buildViewer,
  discoverFlows,
  type BuildViewerOptions,
  type BuildViewerResult,
} from "./render.js";
export {
  placeCallout,
  type Side,
  type Rect,
  type PlaceInput,
  type Placement,
} from "./placement.js";
export {
  arrowGeometry,
  buildBurnTree,
  burnAnnotations,
  burnFlow,
  pngDimensions,
  type ArrowGeometry,
  type BurnFlowOptions,
  type BurnFlowResult,
  type BurnInput,
  type BurnNode,
  type BurnOptions,
  type BurnTreeInput,
} from "./burn.js";
export type { AnnotationRecord, AnnotationsFile, BoundingBox, NudgeOffset } from "./annotations.js";

import { buildViewer, discoverFlows } from "./render.js";
import { burnFlow } from "./burn.js";

const USAGE = `docsxai-viewer — static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...
  docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>]

  build — emit the interactive HTML viewer
    <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md)
    <out-dir>   where the generated viewer is written

  burn — bake annotations into the PNGs (for surfaces that can't run the viewer)
    <workspace>  a site-docs workspace (reads <workspace>/docs)
    --flow       restrict to these flows (default: all flows with annotations.json)
    --out        output root (default: docs/<flow>/burned/<step>.png)
`;

interface ParsedArgs {
  positional: string[];
  flows: string[];
  out?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positional: [], flows: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--flow" && argv[i + 1]) {
      parsed.flows.push(argv[i + 1]!);
      i++;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      parsed.out = argv[i + 1]!;
      i++;
    } else parsed.positional.push(argv[i]!);
  }
  return parsed;
}

async function runBuild(args: ParsedArgs): Promise<number> {
  const [docsDir, outDir] = args.positional;
  if (!docsDir || !outDir) {
    process.stderr.write("build: requires <docs-dir> and <out-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  try {
    const r = await buildViewer({
      docsDir,
      outDir,
      ...(args.flows.length ? { flows: args.flows } : {}),
    });
    process.stdout.write(`viewer: wrote ${r.pages.length} page(s) to ${outDir}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`build: ${(e as Error).message}\n`);
    return 1;
  }
}

async function runBurn(args: ParsedArgs): Promise<number> {
  const [workspace] = args.positional;
  if (!workspace) {
    process.stderr.write("burn: requires <workspace>\n\n" + USAGE + "\n");
    return 2;
  }
  const docsDir = path.join(workspace, "docs");
  try {
    const flows = args.flows.length ? args.flows : await discoverFlows(docsDir);
    if (flows.length === 0) {
      process.stderr.write(`burn: no flows with annotations.json under ${docsDir}\n`);
      return 1;
    }
    for (const flow of flows) {
      const outDir = args.out ? path.join(args.out, flow) : path.join(docsDir, flow, "burned");
      const r = await burnFlow({ docsDir, flow, outDir });
      process.stdout.write(`burn: wrote ${r.written.length} image(s) to ${outDir}\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`burn: ${(e as Error).message}\n`);
    return 1;
  }
}

export async function runViewerCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "build") return runBuild(parseArgs(rest));
  if (command === "burn") return runBurn(parseArgs(rest));
  process.stdout.write(USAGE + "\n");
  return argv.length === 0 ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runViewerCli(process.argv.slice(2)).then((code) => process.exit(code));
}
