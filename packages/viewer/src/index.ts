#!/usr/bin/env node
// @kalebtec/docsxai-viewer — interactive docs-app generator + burned-annotation renderer +
// Starlight site emitter.
//
// Library entry (re-exports `buildViewer`, `burnAnnotations`, `burnFlow`, `emitStarlightSite`,
// `buildStarlightSite`) and bin entry `docsxai-viewer`:
//   docsxai-viewer build <docs-dir> <out-dir> [--flow <name> ...]
//   docsxai-viewer burn <workspace> [--flow <name> ...] [--out <dir>]
//   docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>]
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
export {
  ASTRO_VERSION,
  STARLIGHT_VERSION,
  buildStarlightSite,
  deriveFlowOrder,
  emitStarlightSite,
  normalizeAccent,
  resolveAstroBin,
  type BuildStarlightSiteOptions,
  type BuildStarlightSiteResult,
  type EmitStarlightSiteOptions,
  type EmitStarlightSiteResult,
  type StarlightSiteConfig,
} from "./starlight.js";

import { buildViewer, discoverFlows } from "./render.js";
import { burnFlow } from "./burn.js";
import { buildStarlightSite, emitStarlightSite } from "./starlight.js";

const USAGE = `docsxai-viewer — static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...
  docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>]
  docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--flow <name>]...

  build — emit the interactive HTML viewer
    <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md)
    <out-dir>   where the generated viewer is written

  burn — bake annotations into the PNGs (for surfaces that can't run the viewer)
    <workspace>  a site-docs workspace (reads <workspace>/docs)
    --flow       restrict to these flows (default: all flows with annotations.json)
    --out        output root (default: docs/<flow>/burned/<step>.png)

  site — emit a production Astro Starlight docs site (burned images preferred)
    <workspace>  a site-docs workspace (reads <workspace>/docs + <workspace>/flows)
    --out        site project directory (default: <workspace>/site)
    --build      also run astro build (writes <out>/dist)
    --title      site title (default: "Documentation")
    --accent     accent hex color (overrides the style artifact's visual keys)
    --flow       restrict to these flows (default: all flows with annotations.json)
`;

interface ParsedArgs {
  positional: string[];
  flows: string[];
  out?: string;
  title?: string;
  accent?: string;
  build: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positional: [], flows: [], build: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--flow" && argv[i + 1]) {
      parsed.flows.push(argv[i + 1]!);
      i++;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      parsed.out = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--title" && argv[i + 1]) {
      parsed.title = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--accent" && argv[i + 1]) {
      parsed.accent = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--build") {
      parsed.build = true;
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

async function runSite(args: ParsedArgs): Promise<number> {
  const [workspace] = args.positional;
  if (!workspace) {
    process.stderr.write("site: requires <workspace>\n\n" + USAGE + "\n");
    return 2;
  }
  const outDir = args.out ?? path.join(workspace, "site");
  try {
    const r = await emitStarlightSite({
      workspaceDir: workspace,
      outDir,
      config: {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.accent !== undefined ? { accent: args.accent } : {}),
        ...(args.flows.length ? { flows: args.flows } : {}),
      },
    });
    for (const w of r.warnings) process.stderr.write(`site: warning: ${w}\n`);
    process.stdout.write(`site: emitted ${r.files.length} file(s) to ${outDir}\n`);
    if (args.build) {
      const b = await buildStarlightSite({ siteDir: outDir });
      if (!b.ok) {
        process.stderr.write(`site: astro build failed\n${b.stderr}\n`);
        return 1;
      }
      process.stdout.write(`site: built ${b.distDir} in ${Math.round(b.durationMs)}ms\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`site: ${(e as Error).message}\n`);
    return 1;
  }
}

export async function runViewerCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "build") return runBuild(parseArgs(rest));
  if (command === "burn") return runBurn(parseArgs(rest));
  if (command === "site") return runSite(parseArgs(rest));
  process.stdout.write(USAGE + "\n");
  return argv.length === 0 ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runViewerCli(process.argv.slice(2)).then((code) => process.exit(code));
}
