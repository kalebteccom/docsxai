#!/usr/bin/env node
// @docsxai/viewer — interactive docs-app generator + burned-annotation renderer +
// Starlight site emitter.
//
// Library entry (re-exports `buildViewer`, `burnAnnotations`, `burnFlow`, `emitStarlightSite`,
// `buildStarlightSite`) and bin entry `docsxai-viewer`:
//   docsxai-viewer build <docs-dir> <out-dir> [--flow <name> ...]
//   docsxai-viewer burn <workspace> [--flow <name> ...] [--out <dir>] [--report <file>]
//   docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>]
//   docsxai-viewer pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise]
//   docsxai-viewer pack <workspace-or-raw-dir> --check --against <pack-dir> [--threshold <pct>]
// The plugin's `render` command (and `docsxai render`) shell out to `build`.

import { promises as fs } from "node:fs";
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
  burnReport,
  pngDimensions,
  renderBurn,
  type ArrowGeometry,
  type BurnFlowOptions,
  type BurnFlowResult,
  type BurnInput,
  type BurnNode,
  type BurnOptions,
  type BurnRender,
  type BurnTreeInput,
} from "./burn.js";
export {
  BURN_REPORT_SCHEMA,
  DEFAULT_UNPLACEABLE_RATIO,
  type AnnotationReport,
  type BurnReport,
  type FlowBurnReport,
} from "./burn-report.js";
export type {
  AnnotationPlacement,
  AnnotationRecord,
  AnnotationsFile,
  BoundingBox,
  NudgeOffset,
} from "./annotations.js";
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

export {
  DEFAULT_PUBLIC_PREFIX,
  PACK_MANIFEST_FILE,
  SCREENS_PACK_SCHEMA,
  fileOfSrc,
  normalisePublicPrefix,
  packFilePath,
  parseVariantKey,
  serialisePack,
  type LocalizedText,
  type PackCallout,
  type PackFlow,
  type PackStep,
  type PackVariant,
  type ScreensPack,
  type VariantKeyParts,
} from "./pack-schema.js";
export {
  assertValidPack,
  validatePack,
  type PackValidation,
  type ValidatePackOptions,
} from "./pack-validate.js";
export {
  SCREENS_MANIFEST_V1,
  SCREENS_PACK_V1,
  convertScreensManifestV1,
  convertScreensPackV1,
  type ConvertManifestV1Options,
  type ConvertPackV1Options,
  type ConvertPackV1Result,
  type FileMove,
} from "./pack-convert.js";
export { assertGuarded, guardPack, scanText } from "./pack-guards.js";
export {
  MISSING_OXIPNG,
  OXIPNG_ARGS,
  OXIPNG_BIN_ENV,
  createOxipngOptimiser,
  identityOptimiser,
  type Optimiser,
} from "./pack-optimise.js";
export {
  PACK_CONFIG_FILE,
  PACK_CONFIG_SCHEMA,
  parsePackConfig,
  readWorkspace,
  type PackConfig,
} from "./pack-workspace.js";
export {
  readRawCapture,
  type PackSource,
  type SourceFlow,
  type SourceStep,
  type SourceVariant,
} from "./pack-source.js";
export {
  buildPack,
  hash8,
  viewerBurner,
  type BuildPackOptions,
  type BuiltPack,
  type Burner,
} from "./pack-build.js";
export {
  listedFiles,
  writePack,
  type WritePackOptions,
  type WritePackResult,
} from "./pack-write.js";
export {
  DEFAULT_THRESHOLD_PCT,
  computeDrift,
  readCommittedPack,
  type ComputeDriftOptions,
  type DriftEntry,
  type DriftReport,
  type DriftStatus,
} from "./pack-drift.js";
export { diffGrids, diffPngs, type PixelDiff } from "./pack-pixels.js";

import { buildViewer, discoverFlows } from "./render.js";
import { burnFlow, burnReport } from "./burn.js";
import { DEFAULT_UNPLACEABLE_RATIO, type FlowBurnReport } from "./burn-report.js";
import { buildStarlightSite, emitStarlightSite } from "./starlight.js";
import { PACK_DETAILS, PACK_SYNOPSIS, runPack } from "./pack-cli.js";

const USAGE = `docsxai-viewer — static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]...
  docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>] [--report <file>] [--max-overlap <ratio>] [--no-connector-outline]
  docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--flow <name>]...
${PACK_SYNOPSIS}

  build — emit the interactive HTML viewer
    <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md;
                a flow that ran a matrix holds the same under <flow>/<variant>/, each variant a flow here)
    <out-dir>   where the generated viewer is written

  burn — bake annotations into the PNGs (for surfaces that can't run the viewer)
    <workspace>  a docsxai workspace (reads <workspace>/docs)
    --flow       restrict to these flows (default: all flows with annotations.json); a flow that ran a
                 matrix also selects its <flow>/<variant> outputs
    --out        output root (default: docs/<flow>/burned/<step>.png)
    --report     write a JSON placement report (callout and badge boxes, overlaps, unplaceable
                 flags) to <file>, resolved under <workspace> when relative; every callout is drawn
                 either way
    --max-overlap  share of its own area a callout may cover before the report flags it
                 unplaceable (default ${DEFAULT_UNPLACEABLE_RATIO})
    --no-connector-outline  keep every arrow and stem plain ink; by default one over a dark
                 part of the screenshot gets a white outline

  site — emit a production Astro Starlight docs site (burned images preferred)
    <workspace>  a docsxai workspace (reads <workspace>/docs + <workspace>/flows)
    --out        site project directory (default: <workspace>/site)
    --build      also run astro build (writes <out>/dist)
    --title      site title (default: "Documentation")
    --accent     accent hex color (overrides the style artifact's visual keys)
    --flow       restrict to these flows (default: all flows with annotations.json)

${PACK_DETAILS}`;

interface ParsedArgs {
  positional: string[];
  flows: string[];
  out?: string;
  title?: string;
  accent?: string;
  report?: string;
  maxOverlap?: number;
  plainConnectors: boolean;
  build: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positional: [], flows: [], plainConnectors: false, build: false };
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
    } else if (argv[i] === "--report" && argv[i + 1]) {
      parsed.report = argv[i + 1]!;
      i++;
    } else if (argv[i] === "--max-overlap" && argv[i + 1]) {
      parsed.maxOverlap = Number(argv[i + 1]);
      i++;
    } else if (argv[i] === "--no-connector-outline") {
      parsed.plainConnectors = true;
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
  const ratio = args.maxOverlap;
  if (ratio !== undefined && !(Number.isFinite(ratio) && ratio >= 0)) {
    process.stderr.write("burn: --max-overlap needs a number >= 0\n");
    return 2;
  }
  const docsDir = path.join(workspace, "docs");
  try {
    const found = await discoverFlows(docsDir, { variants: true });
    // `--flow <name>` also selects the `<name>/<variant>` outputs of a flow that ran a matrix.
    const flows = args.flows.length
      ? args.flows.flatMap((want) => {
          const variants = found.filter((f) => f.startsWith(`${want}/`));
          return found.includes(want) ? [want, ...variants] : variants.length ? variants : [want];
        })
      : found;
    if (flows.length === 0) {
      process.stderr.write(`burn: no flows with annotations.json under ${docsDir}\n`);
      return 1;
    }
    const reports: FlowBurnReport[] = [];
    for (const flow of flows) {
      const outDir = args.out ? path.join(args.out, flow) : path.join(docsDir, flow, "burned");
      const r = await burnFlow({
        docsDir,
        flow,
        outDir,
        ...(ratio !== undefined ? { unplaceableRatio: ratio } : {}),
        ...(args.plainConnectors ? { connector: "off" as const } : {}),
      });
      reports.push(r.report);
      process.stdout.write(`burn: wrote ${r.written.length} image(s) to ${outDir}\n`);
    }
    if (args.report) {
      const report = burnReport(reports, ratio);
      const reportPath = path.resolve(workspace, args.report);
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
      process.stdout.write(
        `burn: wrote report to ${reportPath} (${report.unplaceable} unplaceable)\n`,
      );
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
  if (command === "pack") return runPack(rest);
  process.stdout.write(USAGE + "\n");
  return argv.length === 0 ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runViewerCli(process.argv.slice(2)).then((code) => process.exit(code));
}
