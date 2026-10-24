#!/usr/bin/env node
// @docsxai/viewer — interactive docs-app generator + burned-annotation renderer +
// Starlight site emitter.
//
// Library entry (re-exports `buildViewer`, `burnAnnotations`, `burnFlow`, `emitStarlightSite`,
// `buildStarlightSite`) and bin entry `docsxai-viewer`:
//   docsxai-viewer build <docs-dir> <out-dir> [--flow <name> ...] [--lang <locale>]
//   docsxai-viewer burn <workspace> [--flow <name> ...] [--out <dir>] [--report <file>] [--max-overlap <ratio>] [--no-connector-outline]
//   docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--lang <locale>] [--flow <name> ...]
//   docsxai-viewer pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]
//   docsxai-viewer pack <workspace-or-raw-dir> --check --against <pack-dir> [--from-raw] [--threshold <pct>]
// The plugin's `render` command (and `docsxai render`) shell out to `build`.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isDirectory, reportFailure, requireInputDir, withNext } from "./cli-failure.js";
import { isMainModule } from "./main-module.js";

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
  AA_TEXT_RATIO,
  AUTO_SCALE_MAX,
  BADGE_SHAPES,
  DEFAULT_BURN_THEME,
  FONT_WEIGHTS,
  NARROW_BELOW_DEFAULT,
  THEME_PRESET_NAMES,
  THEME_PRESETS,
  captionScale,
  contrastWarnings,
  displayWidthFor,
  scaledTheme,
  themeContrast,
  weightWarnings,
  type BadgeShape,
  type BurnTheme,
  type ContrastCheck,
  type FontWeight,
  type ThemePresetName,
} from "./burn-theme.js";
export {
  BurnThemeError,
  parseThemeConfig,
  resolveBurnTheme,
  type ResolveContext,
  type ThemeConfig,
} from "./burn-theme-config.js";
export { burnWithWorkspaceTheme, type BurnWithWorkspaceThemeInput } from "./burn-workspace.js";
export { THEME_FIELDS, THEME_KEYS, type ThemeKey } from "./burn-theme-fields.js";
export { flattenTokens, type TokenLeaves } from "./burn-theme-tokens.js";
export { loadBurnTheme, loadThemeFont, type LoadedTheme } from "./burn-theme-load.js";
export { themeStyle, themeVariables, type ThemeStyle } from "./burn-theme-css.js";
export { contrastRatio } from "./color.js";
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
  themedBurner,
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

import { buildViewer, discoverFlows, selectFlows } from "./render.js";
import { workspaceTheme } from "./burn-theme-load.js";
import { burnFlow, burnReport } from "./burn.js";
import { DEFAULT_UNPLACEABLE_RATIO, type FlowBurnReport } from "./burn-report.js";
import { buildStarlightSite, emitStarlightSite } from "./starlight.js";
import { PACK_DETAILS, PACK_SYNOPSIS, runPack } from "./pack-cli.js";
import { asksHelp, commandHelp, usageLines } from "./viewer-help.js";

const USAGE = `docsxai-viewer — static viewer generator

Usage:
  docsxai-viewer build <docs-dir> <out-dir> [--flow <name>]... [--lang <locale>]
  docsxai-viewer burn <workspace> [--flow <name>]... [--out <dir>] [--report <file>] [--max-overlap <ratio>] [--no-connector-outline]
  docsxai-viewer site <workspace> [--out <dir>] [--build] [--title <t>] [--accent <hex>] [--lang <locale>] [--flow <name>]...
${PACK_SYNOPSIS}

  build — emit the interactive HTML viewer
    <docs-dir>  a doc pack's docs/ tree (<flow>/annotations.json, <flow>/screenshots/<step>.png, <flow>/<step>.md;
                a flow that ran a matrix holds the same under <flow>/<variant>/, each variant a flow here)
    <out-dir>   where the generated viewer is written
    --flow      restrict to these flows (default: all flows with annotations.json); a flow that ran a
                matrix also selects its <flow>/<variant> pages
    --lang      locale of the text the pages add, e.g. es or es-ES (default: en; other tags give en);
                a matrix variant flow (<flow>/<locale>.<scheme>.<viewport>) uses its own locale

  burn — bake annotations into the PNGs (for surfaces that can't run the viewer)
    <workspace>  a docsxai workspace (reads <workspace>/docs; the burn.theme block of
                 <workspace>/.docsxai.json sets the look, see docs/burn-theming.md)
    --flow       restrict to these flows (default: all flows with annotations.json); a flow that ran a
                 matrix also selects its <flow>/<variant> outputs
    --out        output root (default: docs/<flow>/burned/<step>.png)
    --report     write a JSON placement report (callout and badge boxes, overlaps, unplaceable
                 flags) to <file>, resolved under <workspace> when relative; every callout is drawn
                 either way
    --max-overlap  share of its own area a callout may cover before the report flags it
                 unplaceable (default ${DEFAULT_UNPLACEABLE_RATIO})
    --no-connector-outline  skip reading the screenshot's pixels: an arrow or stem stays plain ink
                 (by default one over a dark part gets a white outline), a themed line keeps the
                 callout's outline colour, and no text is estimated from the pixels

  site — emit a production Astro Starlight docs site (burned images preferred)
    <workspace>  a docsxai workspace (reads <workspace>/docs + <workspace>/flows)
    --out        site project directory (default: <workspace>/site)
    --build      also run astro build (writes <out>/dist)
    --title      site title (default: "Documentation")
    --accent     accent hex color (overrides the style artifact's visual keys)
    --lang       locale of the site, e.g. es or es-ES (default: en; other tags give en); sets
                 Starlight's language and the text of the copy and retry components
    --flow       restrict to these flows (default: all flows with annotations.json)

${PACK_DETAILS}`;

interface ParsedArgs {
  positional: string[];
  flows: string[];
  out?: string;
  title?: string;
  accent?: string;
  lang?: string;
  report?: string;
  maxOverlap?: number;
  plainConnectors: boolean;
  build: boolean;
  /** The usage-error message when the argv names an unknown flag or leaves a flag without its value. */
  error?: string;
}

const VALUED_FLAGS = [
  "--flow",
  "--out",
  "--title",
  "--accent",
  "--lang",
  "--report",
  "--max-overlap",
];

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { positional: [], flows: [], plainConnectors: false, build: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (VALUED_FLAGS.includes(a)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        return { ...parsed, error: `${a} needs a value` };
      if (a === "--flow") parsed.flows.push(value);
      else if (a === "--out") parsed.out = value;
      else if (a === "--title") parsed.title = value;
      else if (a === "--accent") parsed.accent = value;
      else if (a === "--lang") parsed.lang = value;
      else if (a === "--report") parsed.report = value;
      else parsed.maxOverlap = Number(value);
    } else if (a === "--no-connector-outline") parsed.plainConnectors = true;
    else if (a === "--build") parsed.build = true;
    else if (a.startsWith("--")) return { ...parsed, error: `unknown flag ${a}` };
    else parsed.positional.push(a);
  }
  return parsed;
}

/** The `docsxai-viewer <command>` line(s) of the help text. */
const usageOf = (command: string): string => usageLines(USAGE, command).join("\n       ");

/** A usage error shows the failing command's own usage line, not the whole help text. Returns exit code 2. */
function usageError(command: string, message: string): number {
  const hint = "run `docsxai-viewer` with no arguments for every flag";
  process.stderr.write(`${command}: ${message}\nusage: ${usageOf(command)}\n${hint}\n`);
  return 2;
}

/** Where a theme's contrast warnings go. */
const warnTheme = (command: string) => (message: string) =>
  process.stderr.write(`${command}: warning: ${message}\n`);

async function runBuild(args: ParsedArgs): Promise<number> {
  if (args.error) return usageError("build", args.error);
  const [docsDir, outDir] = args.positional;
  if (!docsDir || !outDir) return usageError("build", "requires <docs-dir> and <out-dir>");
  try {
    // `docsxai render` passes `<workspace>/docs`; the workspace's `burn.theme` styles the captions.
    const docsPath = path.resolve(docsDir);
    const theme =
      path.basename(docsPath) === "docs"
        ? await workspaceTheme(path.dirname(docsPath), warnTheme("build"))
        : undefined;
    const r = await buildViewer({
      docsDir,
      outDir,
      ...(args.flows.length ? { flows: args.flows } : {}),
      ...(args.lang !== undefined ? { lang: args.lang } : {}),
      ...(theme ? { theme } : {}),
    });
    for (const w of r.warnings) process.stderr.write(`viewer: warning: ${w}\n`);
    if (r.pages.length === 1 && !args.flows.length) {
      const cause = (await isDirectory(docsDir))
        ? "no flows with annotations.json under"
        : "no docs directory at";
      process.stderr.write(
        `viewer: warning: ${withNext(`${cause} ${docsDir}, so the index is empty`, "docsxai run <workspace-dir>, or fix the path")}\n`,
      );
    }
    process.stdout.write(`viewer: wrote ${r.pages.length} page(s) to ${outDir}\n`);
    return 0;
  } catch (e) {
    return reportFailure("build", e);
  }
}

async function runBurn(args: ParsedArgs): Promise<number> {
  if (args.error) return usageError("burn", args.error);
  const [workspace] = args.positional;
  if (!workspace) return usageError("burn", "requires <workspace>");
  const ratio = args.maxOverlap;
  if (ratio !== undefined && !(Number.isFinite(ratio) && ratio >= 0)) {
    return usageError("burn", "--max-overlap needs a number >= 0");
  }
  const docsDir = path.join(workspace, "docs");
  try {
    const theme = await workspaceTheme(workspace, warnTheme("burn"));
    const found = await discoverFlows(docsDir, { variants: true });
    // `--flow <name>` also selects the `<name>/<variant>` outputs of a flow that ran a matrix.
    const flows = args.flows.length ? selectFlows(found, args.flows) : found;
    if (flows.length === 0) {
      const note = withNext(
        `no flows with annotations.json under ${docsDir}`,
        "docsxai run <workspace-dir>",
      );
      process.stderr.write(`burn: ${note}\n`);
      return 1;
    }
    const reports: FlowBurnReport[] = [];
    let images = 0;
    for (const flow of flows) {
      const outDir = args.out ? path.join(args.out, flow) : path.join(docsDir, flow, "burned");
      const r = await burnFlow({
        docsDir,
        flow,
        outDir,
        ...(ratio !== undefined ? { unplaceableRatio: ratio } : {}),
        ...(args.plainConnectors ? { connector: "off" as const } : {}),
        ...(theme ? { theme } : {}),
      });
      reports.push(r.report);
      images += r.written.length;
      process.stdout.write(`burn: wrote ${r.written.length} image(s) to ${outDir}\n`);
    }
    if (flows.length > 1) {
      const root = args.out ?? path.join(docsDir, "<flow>", "burned");
      process.stdout.write(`burn: ${images} image(s) from ${flows.length} flows in ${root}\n`);
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
    return reportFailure("burn", e);
  }
}

async function runSite(args: ParsedArgs): Promise<number> {
  if (args.error) return usageError("site", args.error);
  const [workspace] = args.positional;
  if (!workspace) return usageError("site", "requires <workspace>");
  const outDir = args.out ?? path.join(workspace, "site");
  if (
    !(await requireInputDir(
      "site",
      workspace,
      "workspace",
      "docsxai init <workspace-dir>, or fix the path",
    ))
  )
    return 1;
  if (
    !(await requireInputDir(
      "site",
      path.join(workspace, "docs"),
      "docs directory",
      "docsxai run <workspace-dir>, or fix the path",
    ))
  )
    return 1;
  try {
    const r = await emitStarlightSite({
      workspaceDir: workspace,
      outDir,
      config: {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.accent !== undefined ? { accent: args.accent } : {}),
        ...(args.lang !== undefined ? { lang: args.lang } : {}),
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
    return reportFailure("site", e);
  }
}

export async function runViewerCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (["build", "burn", "site", "pack"].includes(command ?? "") && asksHelp(rest)) {
    process.stdout.write(commandHelp(USAGE, command!));
    return 0;
  }
  if (command === "build") return runBuild(parseArgs(rest));
  if (command === "burn") return runBurn(parseArgs(rest));
  if (command === "site") return runSite(parseArgs(rest));
  if (command === "pack") return runPack(rest);
  process.stdout.write(USAGE + "\n");
  return argv.length === 0 ? 0 : 2;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void runViewerCli(process.argv.slice(2)).then((code) => process.exit(code));
}
