// Durable burned-annotation renderer — bakes halo + badge + callout + arrow into the PNG for
// delivery surfaces that can't run the interactive viewer (Confluence, Notion, plain wikis).
//
// Browser-free by design: no Chromium, no playwright, no DOM. The pipeline is
// Satori (flexbox-subset layout → SVG) → resvg (SVG → PNG). The clean screenshot is embedded in
// the Satori tree as a data-URI <img>, so the whole frame rasterises in a single resvg pass —
// one encoder produces every output byte, there is no separate composite/re-encode step, and the
// output is byte-stable across runs: Satori layout and resvg rasterisation are pure functions of
// their inputs, the only font is the vendored Inter or the theme's own font file (system fonts are
// not loaded), text becomes glyph paths inside the SVG, and resvg's PNG encoder writes no
// timestamps.
//
// Placement reuses the interactive overlay's `placeCallout` (placement.ts) in screenshot pixel
// space; text sizing uses the vendored font's own metrics (font-metrics.ts) instead of the
// overlay's DOM probe. Colours, radii and type sizes come from the caption theme (burn-theme.ts);
// the viewer CSS reads the same values.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Rect } from "./placement.js";
import { planBadge } from "./badge-placement.js";
import { arrowGeometry, type ArrowGeometry } from "./arrow.js";
import {
  DEFAULT_BURN_THEME,
  captionScale,
  haloRadius,
  scaledTheme,
  type BurnTheme,
} from "./burn-theme.js";
import { loadThemeFont } from "./burn-theme-load.js";
import { rgbaOf } from "./color.js";
import { badgeNode, calloutNodes, calloutStyleOf, div, effectiveWeight } from "./burn-nodes.js";
import { DOCK_MAX_SHARE, cleanObstacles, cornerBadge, dockMargin, haloBox } from "./burn-clean.js";
import { planClean } from "./burn-clean-plan.js";
import { LINE_GAP, LINE_MAX_DISTANCE, drawnStyle } from "./burn-line.js";
import type { PixelGrid } from "./connector-contrast.js";
import { decodeScreenshot } from "./screenshot-pixels.js";
import { parseFontMetrics, type FontMetrics } from "./font-metrics.js";
import { glyphReport } from "./burn-glyphs.js";
import { atBaseSize, checkPixelRatio, layoutAtScale, scaleRect } from "./burn-scale.js";
import { badgeBox, badgeSize, keepClear, otherHalos, OUTSIDE_HALO_MARGIN } from "./burn-badge.js";
import {
  layoutBoxes,
  layoutCallout,
  type CalloutLayout,
  type LayoutInput,
} from "./burn-callout.js";
import {
  annotationReport,
  skippedReport,
  DEFAULT_UNPLACEABLE_RATIO,
  type AnnotationReport,
  type FlowBurnReport,
  type RouteReport,
} from "./burn-report.js";
import { routeClean } from "./burn-route.js";
import type { AnnotationRecord } from "./annotations.js";
import { fitAnnotation } from "./burn-fit.js";
import { readAnnotationList, readDeviceScaleFactor } from "./burn-annotations-file.js";
import { readTextIfPresent } from "./safe-read.js";

export { arrowGeometry, type ArrowGeometry };
export { burnReport } from "./burn-report.js";

type Warn = (message: string) => void;
const defaultWarn: Warn = (message) => console.warn(message);

export interface BurnNodeProps {
  style?: Record<string, string | number>;
  children?: BurnNode[] | string;
  src?: string;
  width?: number;
  height?: number;
}
/** A Satori element (React-element-shaped plain object). */
export interface BurnNode {
  type: string;
  props: BurnNodeProps;
}

/** Reads PNG dimensions from the IHDR chunk. */
export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const isPng =
    png.length > 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!) === "IHDR";
  if (!isPng) throw new Error("screenshot is not a PNG (bad signature or missing IHDR)");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface BurnTreeInput {
  image: { width: number; height: number; dataUri: string };
  annotations: AnnotationRecord[];
  metrics: FontMetrics;
  warn?: Warn;
  /** Receives one entry per input annotation, in order, for `burn --report`. */
  report?: AnnotationReport[];
  /** `overlap_ratio` above which a report entry is `unplaceable`. Default {@link DEFAULT_UNPLACEABLE_RATIO}. */
  unplaceableRatio?: number;
  /**
   * Device pixels per CSS pixel of the screenshot (default 1). A 2x capture passes 2, so the phone
   * chrome bands, side margins and text floors, which are CSS px, grow with it.
   */
  pixelRatio?: number;
  /**
   * The screenshot's pixels. With them, an arrow or stem over a dark background gets a white
   * outline. Without them every connector is plain ink.
   */
  pixels?: PixelGrid;
  /** The caption look. Default {@link DEFAULT_BURN_THEME}, today's. */
  theme?: BurnTheme;
  /** Receives what each callout was laid out from and how, at base size, for placement probes. */
  trace?: CalloutTrace[];
}

/** One callout's layout input and result at base size; `scale` multiplies them to screenshot px. */
export interface CalloutTrace {
  /** Position of the annotation in the input list. */
  position: number;
  input: LayoutInput;
  layout: CalloutLayout;
  scale: number;
}

/** Family name the theme's own font file is registered under in Satori. */
const THEME_FONT_NAME = "ThemeFont";

/**
 * Satori 0.62 sizes a box by its content (CSS `content-box`), where 0.33 sized it by its border box.
 * Pinning `border-box` on every div keeps each halo, callout and badge at the size the layout planned.
 * Applied on the way into Satori so `buildBurnTree` output stays as it was.
 */
function withBorderBox(node: BurnNode): BurnNode {
  const children = node.props.children;
  const props: BurnNodeProps = {
    ...node.props,
    ...(Array.isArray(children) ? { children: children.map(withBorderBox) } : {}),
  };
  if (node.type === "div") props.style = { boxSizing: "border-box", ...node.props.style };
  return { type: node.type, props };
}

/** Builds the Satori element tree: the screenshot full-bleed, overlays absolutely positioned. */
export function buildBurnTree(input: BurnTreeInput): BurnNode {
  const { width, height } = input.image;
  const image = { width, height };
  const warn = input.warn ?? defaultWarn;
  const base = input.theme ?? DEFAULT_BURN_THEME;
  // Layout runs at base size on an image shrunk by `f`; what it decides is multiplied back by `f`
  // when drawn, so every caption dimension scales together. At 1 nothing is converted.
  const pr = checkPixelRatio(input.pixelRatio ?? 1);
  // Width classes (phone, desktop, `display_width`) are CSS px: a 2x phone capture is 780 px wide.
  const cssWidth = width / pr;
  const f = captionScale(base, width, pr);
  const theme = scaledTheme(base, f);
  const themed = input.theme !== undefined;
  const style = calloutStyleOf(base, themed);
  const connector = drawnStyle(base.connectorStyle, themed);
  const baseImage = f === 1 ? image : { width: width / f, height: height / f };
  const children: BurnNode[] = [
    {
      type: "img",
      props: {
        src: input.image.dataUri,
        width,
        height,
        style: { position: "absolute", left: 0, top: 0 },
      },
    },
  ];
  const placed: Rect[] = [];
  /** Caption boxes drawn so far, at base size; a clean caption never covers one. */
  const captions: Rect[] = [];
  const badges = new Map<AnnotationRecord, Rect>();
  const threshold = input.unplaceableRatio ?? DEFAULT_UNPLACEABLE_RATIO;

  // A box resvg can't draw (off the image, no area, NaN) is skipped; one that overhangs an edge is clipped.
  const fitted = input.annotations.map((a) => fitAnnotation(a, image));
  // A skipped record loses its box so the others don't place around a shape that isn't drawn.
  const drawable = fitted.map((f, i) => {
    if ("ann" in f) return f.ann;
    const { bounding_box: _dropped, ...rest } = input.annotations[i]!;
    return rest;
  });
  const baseAnnotations = drawable.map((a) => atBaseSize(a, f));
  // The line connector comes with the clean look: halos and badges outside their targets, and text
  // estimated from the pixels for annotations that list no obstacles.
  const clean = connector !== "arrow";
  for (const [i, fit] of fitted.entries()) {
    const original = input.annotations[i]!;
    if ("skip" in fit) {
      warn(
        original.bounding_box
          ? `burn: annotation "${original.selector}" on step "${original.step}": ${fit.skip}, skipped`
          : `burn: annotation on step "${original.step}" has no bounding_box, skipped`,
      );
      input.report?.push(skippedReport(original, fit.skip));
      continue;
    }
    const realAnn = fit.ann;
    const self = baseAnnotations[i]!;
    // Clean: text from the pixels, other targets and phone chrome join the obstacles.
    const prep = clean
      ? cleanObstacles(
          self,
          realAnn.bounding_box,
          input.pixels,
          f,
          baseAnnotations,
          baseImage,
          cssWidth,
          pr,
        )
      : { ann: self, badgeObstacles: self.obstacles ?? [] };
    const ann = prep.ann;
    const t = ann.bounding_box!;
    const real = haloBox(realAnn.bounding_box!, clean, f);
    children.push(
      div({
        position: "absolute",
        left: real.x,
        top: real.y,
        width: real.width,
        height: real.height,
        border: `${2 * f}px solid ${theme.accent}`,
        borderRadius: haloRadius(theme) + (clean ? 5 * f : 0),
        boxShadow: `0 0 0 ${3 * f}px ${rgbaOf(theme.accent, 0.35)}`,
      }),
    );

    // The badge goes first so this annotation's callout and later ones keep clear of where it landed.
    const blockers = [
      ...otherHalos(baseAnnotations, self, clean ? OUTSIDE_HALO_MARGIN : undefined),
      ...placed,
      ...badges.values(),
    ];
    const size = typeof ann.index === "number" ? badgeSize(ann.index, input.metrics) : null;
    const badge =
      size === null
        ? undefined
        : clean
          ? cornerBadge(t, size, baseImage, blockers, prep)
          : ann.obstacles?.length
            ? planBadge({
                image: baseImage,
                target: t,
                size,
                obstacles: ann.obstacles,
                avoid: blockers,
              })
            : badgeBox(t, ann.index!, baseImage, input.metrics);
    if (badge) badges.set(self, badge);

    let layout: CalloutLayout | null = null;
    let calloutBox: Rect | null = null;
    let badgeOnly = false;
    let route: RouteReport = { route: "none", connector_crossings: 0 };
    if (ann.copy) {
      const clear = keepClear(
        baseAnnotations,
        self,
        baseImage,
        input.metrics,
        placed,
        badges,
        clean,
      );
      const layoutInput: LayoutInput = {
        ann,
        target: t,
        image: baseImage,
        metrics: input.metrics,
        clear,
        style,
        arrowLength: base.arrowSize,
        maxWidthRatio: base.maxWidthRatio,
        ...(clean
          ? {
              gap: LINE_GAP,
              maxDistance: LINE_MAX_DISTANCE,
              dock: dockMargin(f, cssWidth, baseImage, pr),
              dockMax: DOCK_MAX_SHARE * baseImage.height,
              forbid: [...captions, ...badges.values()],
            }
          : {}),
      };
      const mode = clean ? base.captionStyle : "full";
      const routed =
        clean && mode !== "badge"
          ? routeClean(
              layoutInput,
              planClean(layoutInput, base, f, cssWidth, mode === "auto", pr),
              f,
              badge,
            )
          : null;
      const plan = routed?.plan ?? null;
      badgeOnly = mode === "badge" || (mode === "auto" && plan !== null && plan.cover > 0);
      if (routed && !badgeOnly)
        route = { route: routed.route, connector_crossings: routed.crossings };
      if (!badgeOnly) {
        const planned = plan ? plan.layout : layoutCallout(layoutInput);
        input.trace?.push({ position: i, input: layoutInput, layout: planned, scale: f });
        placed.push(...layoutBoxes(planned));
        captions.push(layoutBoxes(planned)[0]!);
        layout = layoutAtScale(planned, f);
        const drawn = calloutNodes(
          layout,
          plan?.theme ?? theme,
          f,
          themed,
          connector,
          input.pixels,
        );
        children.push(...drawn.nodes);
        calloutBox = drawn.boxes[0]!;
      }
    }

    // A badge-only annotation is numbered by its place in the list when it has no index of its own.
    const number = typeof ann.index === "number" ? ann.index : badgeOnly ? i + 1 : null;
    const ownBadge =
      badge ??
      (badgeOnly && number !== null
        ? cornerBadge(t, badgeSize(number, input.metrics), baseImage, blockers, prep)
        : undefined);
    if (ownBadge) badges.set(self, ownBadge);
    const realBadge = ownBadge ? scaleRect(ownBadge, f) : undefined;
    if (realBadge && number !== null) children.push(badgeNode(realBadge, number, theme, f));
    const entry = annotationReport(
      realAnn,
      layout,
      calloutBox,
      realBadge,
      threshold,
      clean ? route : undefined,
    );
    input.report?.push({
      ...entry,
      ...(badgeOnly ? { caption_style: "badge" as const } : {}),
      ...(layout ? glyphReport(ann, input.metrics, warn) : {}),
    });
  }

  return div(
    {
      position: "relative",
      display: "flex",
      width,
      height,
      fontFamily: base.fontFile !== null ? THEME_FONT_NAME : "Inter",
    },
    children,
  );
}

const FONT_URL = new URL("../assets/fonts/inter-regular.ttf", import.meta.url);
let fontCache: { data: Buffer; metrics: FontMetrics } | undefined;
async function loadFont(): Promise<{ data: Buffer; metrics: FontMetrics }> {
  if (!fontCache) {
    const data = await fs.readFile(FONT_URL);
    fontCache = { data, metrics: parseFontMetrics(data) };
  }
  return fontCache;
}

export interface BurnOptions {
  /** The caption look (see burn-theme.ts). Default: today's look, byte for byte. */
  theme?: BurnTheme;
  /** Receives skip warnings (default: console.warn). */
  warn?: Warn;
  /**
   * Share of its own area a callout may still cover before the report flags it `unplaceable`
   * (default {@link DEFAULT_UNPLACEABLE_RATIO}). Reporting only: every callout is drawn either way.
   */
  unplaceableRatio?: number;
  /** Device pixels per CSS pixel of the screenshot, default 1; see {@link BurnTreeInput.pixelRatio}. */
  pixelRatio?: number;
  /**
   * Outline the arrow and stem in white where the screenshot under them is dark (default
   * `"auto"`; `"off"` always draws plain ink). Screenshots that are light under the connector
   * burn the same either way.
   */
  connector?: "auto" | "off";
}

export interface BurnInput {
  screenshotPath?: string;
  screenshotBuffer?: Buffer;
  /** `docsxai/annotations@1`-shaped records for ONE screenshot. */
  annotations: AnnotationRecord[];
  options?: BurnOptions;
}

export interface BurnRender {
  png: Buffer;
  /** One entry per input annotation, in order. */
  report: AnnotationReport[];
}

/** Renders `annotations` onto the screenshot; returns the burned PNG and where everything landed. */
export async function renderBurn(input: BurnInput): Promise<BurnRender> {
  const screenshot =
    input.screenshotBuffer ??
    (input.screenshotPath !== undefined ? await fs.readFile(input.screenshotPath) : undefined);
  if (!screenshot) {
    throw new Error("burnAnnotations: provide screenshotPath or screenshotBuffer");
  }
  const { width, height } = pngDimensions(screenshot);
  const theme = input.options?.theme;
  const themed = theme ? await loadThemeFont(theme) : undefined;
  const font = themed ?? (await loadFont());
  const fontName = themed ? THEME_FONT_NAME : "Inter";
  const report: AnnotationReport[] = [];
  const hasConnector = input.annotations.some((a) => a.copy && a.bounding_box);
  const pixels =
    input.options?.connector !== "off" && hasConnector
      ? decodeScreenshot(screenshot, width, height)
      : undefined;
  const tree = buildBurnTree({
    image: { width, height, dataUri: `data:image/png;base64,${screenshot.toString("base64")}` },
    annotations: input.annotations,
    metrics: font.metrics,
    report,
    ...(theme ? { theme } : {}),
    ...(pixels ? { pixels } : {}),
    ...(input.options?.warn ? { warn: input.options.warn } : {}),
    ...(input.options?.unplaceableRatio !== undefined
      ? { unplaceableRatio: input.options.unplaceableRatio }
      : {}),
    ...(input.options?.pixelRatio !== undefined ? { pixelRatio: input.options.pixelRatio } : {}),
  });
  const svg = await satori(withBorderBox(tree), {
    width,
    height,
    fonts: [
      {
        name: fontName,
        data: font.data,
        weight: (theme ? effectiveWeight(theme) : 400) as 400 | 600,
        style: "normal",
      },
    ],
  });
  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  return { png, report };
}

/** Renders `annotations` onto the screenshot; returns the burned PNG (byte-stable across runs). */
export async function burnAnnotations(input: BurnInput): Promise<Buffer> {
  return (await renderBurn(input)).png;
}

export interface BurnFlowOptions {
  /** The doc pack's `docs/` directory. */
  docsDir: string;
  flow: string;
  /** Default: `<docsDir>/<flow>/burned`. */
  outDir?: string;
  warn?: Warn;
  /** See {@link BurnOptions.unplaceableRatio}. */
  unplaceableRatio?: number;
  /** See {@link BurnOptions.connector}. */
  connector?: "auto" | "off";
  /** See {@link BurnOptions.theme}. */
  theme?: BurnTheme;
  /**
   * See {@link BurnOptions.pixelRatio}. Default: the `device_scale_factor` of the flow's
   * `annotations.json`, else 1.
   */
  pixelRatio?: number;
}

export interface BurnFlowResult {
  /** PNG filenames written under `outDir`, sorted. */
  written: string[];
  /** Per-annotation placement report for the flow: screenshots in name order, then steps with no screenshot. */
  report: FlowBurnReport;
}

/**
 * Burns a whole flow: every screenshot under `docs/<flow>/screenshots/` lands in `outDir` —
 * annotated steps burned, annotation-less steps copied unchanged (so the burned directory is the
 * complete drop-in image set for the flow). Steps with annotations but no screenshot warn + skip.
 */
export async function burnFlow(opts: BurnFlowOptions): Promise<BurnFlowResult> {
  const warn = opts.warn ?? defaultWarn;
  const flowDir = path.join(opts.docsDir, opts.flow);
  const annPath = path.join(flowDir, "annotations.json");
  const raw = await readTextIfPresent(annPath);
  if (raw === null) throw new Error(`burnFlow: no annotations.json under ${flowDir}`);
  const byStep = new Map<string, AnnotationRecord[]>();
  const annotationList = readAnnotationList(raw, annPath);
  const pixelRatio = opts.pixelRatio ?? readDeviceScaleFactor(raw, annPath);
  for (const ann of annotationList) {
    const list = byStep.get(ann.step) ?? [];
    list.push(ann);
    byStep.set(ann.step, list);
  }

  const shotsDir = path.join(flowDir, "screenshots");
  const shots = (await fs.readdir(shotsDir).catch(() => [] as string[]))
    .filter((f) => f.endsWith(".png"))
    .sort();
  const outDir = opts.outDir ?? path.join(flowDir, "burned");
  await fs.mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const reports: AnnotationReport[] = [];
  const burnedSteps = new Set<string>();
  for (const file of shots) {
    const step = file.replace(/\.png$/, "");
    burnedSteps.add(step);
    const annotations = byStep.get(step) ?? [];
    const dest = path.join(outDir, file);
    if (annotations.length === 0) {
      await fs.copyFile(path.join(shotsDir, file), dest);
    } else {
      const burned = await renderBurn({
        screenshotPath: path.join(shotsDir, file),
        annotations,
        options: {
          warn,
          ...(opts.unplaceableRatio !== undefined
            ? { unplaceableRatio: opts.unplaceableRatio }
            : {}),
          ...(opts.connector ? { connector: opts.connector } : {}),
          ...(opts.theme ? { theme: opts.theme } : {}),
          ...(pixelRatio !== undefined ? { pixelRatio } : {}),
        },
      });
      await fs.writeFile(dest, burned.png);
      reports.push(...burned.report);
    }
    written.push(file);
  }
  for (const step of byStep.keys()) {
    if (!burnedSteps.has(step)) {
      warn(`burn: step "${step}" has annotations but no screenshot, skipped`);
      reports.push(...byStep.get(step)!.map((a) => skippedReport(a, "no screenshot")));
    }
  }
  return { written, report: { flow: opts.flow, annotations: reports } };
}
