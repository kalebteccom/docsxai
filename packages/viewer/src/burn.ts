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
  badgeRadius,
  captionScale,
  connectorColor,
  haloRadius,
  scaledTheme,
  type BurnTheme,
} from "./burn-theme.js";
import { loadThemeFont } from "./burn-theme-load.js";
import { rgbaOf } from "./color.js";
import { connectorNodes } from "./burn-connector.js";
import { CONNECTOR_HALO } from "./connector-contrast.js";
import type { PixelGrid } from "./connector-contrast.js";
import { decodeScreenshot } from "./screenshot-pixels.js";
import { parseFontMetrics, type FontMetrics } from "./font-metrics.js";
import { atBaseSize, layoutAtScale, scaleRect } from "./burn-scale.js";
import {
  BADGE_BORDER,
  BADGE_FONT_SIZE,
  badgeBox,
  badgeSize,
  keepClear,
  otherHalos,
} from "./burn-badge.js";
import {
  layoutBoxes,
  layoutCallout,
  type CalloutLayout,
  type CalloutStyle,
  type LayoutInput,
} from "./burn-callout.js";
import {
  annotationReport,
  skippedReport,
  BURN_REPORT_SCHEMA,
  DEFAULT_UNPLACEABLE_RATIO,
  type AnnotationReport,
  type BurnReport,
  type FlowBurnReport,
} from "./burn-report.js";
import type { AnnotationRecord, AnnotationsFile } from "./annotations.js";

export { arrowGeometry, type ArrowGeometry };

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

function div(style: Record<string, string | number>, children?: BurnNode[] | string): BurnNode {
  return { type: "div", props: { style, ...(children !== undefined ? { children } : {}) } };
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

/** Weight the callout text is drawn in: the theme's, when its own font file can supply it. */
const effectiveWeight = (theme: BurnTheme): number =>
  theme.fontFile !== null ? theme.fontWeight : 400;

/**
 * What sizes a callout box under `theme`. A burn given a theme balances its lines; one without
 * keeps the greedy wrap it always had, so its bytes do not move.
 */
const calloutStyleOf = (theme: BurnTheme, themed: boolean): CalloutStyle => ({
  fontSize: theme.fontSize,
  lineHeight: theme.lineHeight,
  paddingX: theme.paddingX,
  paddingY: theme.paddingY,
  borderWidth: theme.calloutBorderWidth,
  ...(themed ? { wrap: "balance" as const } : {}),
});

interface DrawnCallout {
  nodes: BurnNode[];
  /** Boxes the callout, arrow and stem occupy (nudge applied), for later annotations to avoid. */
  boxes: Rect[];
}

/**
 * `layout` and `theme` are in screenshot px, already multiplied by the caption scale `f`. With
 * `themed`, a connector lost on the pixels under it takes the callout's fill (see burn-connector.ts).
 */
function calloutNodes(
  layout: CalloutLayout,
  theme: BurnTheme,
  f: number,
  themed: boolean,
  pixels?: PixelGrid,
): DrawnCallout {
  const { lines, size: callout, nudge } = layout;
  const nodes: BurnNode[] = connectorNodes(
    layout,
    pixels,
    connectorColor(theme),
    CONNECTOR_HALO * f,
    themed ? theme.calloutBackground : undefined,
  );
  nodes.push(
    div(
      {
        position: "absolute",
        left: layout.callout.x + nudge.x,
        top: layout.callout.y + nudge.y,
        width: callout.width,
        height: callout.height,
        display: "flex",
        flexDirection: "column",
        paddingTop: theme.paddingY,
        paddingBottom: theme.paddingY,
        paddingLeft: layout.paddingX ?? theme.paddingX,
        paddingRight: layout.paddingX ?? theme.paddingX,
        backgroundColor: theme.calloutBackground,
        border: `${theme.calloutBorderWidth}px solid ${theme.calloutBorderColor}`,
        borderRadius: theme.radius,
        color: theme.ink,
        fontSize: theme.fontSize,
        ...(effectiveWeight(theme) !== 400 ? { fontWeight: effectiveWeight(theme) } : {}),
        ...(theme.shadow !== null ? { boxShadow: theme.shadow } : {}),
      },
      lines.map((line) =>
        div(
          { height: theme.lineHeight, lineHeight: `${theme.lineHeight}px`, whiteSpace: "nowrap" },
          line,
        ),
      ),
    ),
  );
  return { nodes, boxes: layoutBoxes(layout) };
}

function badgeNode(box: Rect, index: number, theme: BurnTheme, f: number): BurnNode {
  return div(
    {
      position: "absolute",
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.badgeFill,
      border: `${BADGE_BORDER * f}px solid #fff`,
      borderRadius: badgeRadius(theme.badgeShape, box.height),
      color: "#fff",
      fontSize: BADGE_FONT_SIZE * f,
    },
    String(index),
  );
}

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
  const f = captionScale(base, width);
  const theme = scaledTheme(base, f);
  const themed = input.theme !== undefined;
  const style = calloutStyleOf(base, themed);
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
  const badges = new Map<AnnotationRecord, Rect>();
  const threshold = input.unplaceableRatio ?? DEFAULT_UNPLACEABLE_RATIO;

  const baseAnnotations = input.annotations.map((a) => atBaseSize(a, f));
  for (const [i, realAnn] of input.annotations.entries()) {
    const ann = baseAnnotations[i]!;
    if (!ann.bounding_box) {
      warn(`burn: annotation on step "${ann.step}" has no bounding_box — skipped`);
      input.report?.push(skippedReport(ann, "no bounding_box"));
      continue;
    }
    const t = ann.bounding_box;
    const real = realAnn.bounding_box!;
    children.push(
      div({
        position: "absolute",
        left: real.x,
        top: real.y,
        width: real.width,
        height: real.height,
        border: `${2 * f}px solid ${theme.accent}`,
        borderRadius: haloRadius(theme),
        boxShadow: `0 0 0 ${3 * f}px ${rgbaOf(theme.accent, 0.35)}`,
      }),
    );

    // The badge goes first so this annotation's callout and later ones keep clear of where it landed.
    const badge =
      typeof ann.index === "number"
        ? ann.obstacles?.length
          ? planBadge({
              image: baseImage,
              target: t,
              size: badgeSize(ann.index, input.metrics),
              obstacles: ann.obstacles,
              avoid: [...otherHalos(baseAnnotations, ann), ...placed, ...badges.values()],
            })
          : badgeBox(t, ann.index, baseImage, input.metrics)
        : undefined;
    if (badge) badges.set(ann, badge);

    let layout: CalloutLayout | null = null;
    let calloutBox: Rect | null = null;
    if (ann.copy) {
      const clear = keepClear(baseAnnotations, ann, baseImage, input.metrics, placed, badges);
      const layoutInput: LayoutInput = {
        ann,
        target: t,
        image: baseImage,
        metrics: input.metrics,
        clear,
        style,
        arrowLength: base.arrowSize,
        maxWidthRatio: base.maxWidthRatio,
      };
      const planned = layoutCallout(layoutInput);
      input.trace?.push({ position: i, input: layoutInput, layout: planned, scale: f });
      placed.push(...layoutBoxes(planned));
      layout = layoutAtScale(planned, f);
      const drawn = calloutNodes(layout, theme, f, themed, input.pixels);
      children.push(...drawn.nodes);
      calloutBox = drawn.boxes[0]!;
    }

    const realBadge = badge ? scaleRect(badge, f) : undefined;
    if (realBadge && typeof ann.index === "number") {
      children.push(badgeNode(realBadge, ann.index, theme, f));
    }
    input.report?.push(annotationReport(realAnn, layout, calloutBox, realBadge, threshold));
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
}

export interface BurnFlowResult {
  /** PNG filenames written under `outDir`, sorted. */
  written: string[];
  /** Per-annotation placement report for the flow: screenshots in name order, then steps with no screenshot. */
  report: FlowBurnReport;
}

/** Wraps flow reports into the document `burn --report` writes. */
export function burnReport(
  flows: FlowBurnReport[],
  threshold: number = DEFAULT_UNPLACEABLE_RATIO,
): BurnReport {
  return {
    schema: BURN_REPORT_SCHEMA,
    threshold,
    flows,
    unplaceable: flows.reduce((n, f) => n + f.annotations.filter((a) => a.unplaceable).length, 0),
  };
}

/**
 * Burns a whole flow: every screenshot under `docs/<flow>/screenshots/` lands in `outDir` —
 * annotated steps burned, annotation-less steps copied unchanged (so the burned directory is the
 * complete drop-in image set for the flow). Steps with annotations but no screenshot warn + skip.
 */
export async function burnFlow(opts: BurnFlowOptions): Promise<BurnFlowResult> {
  const warn = opts.warn ?? defaultWarn;
  const flowDir = path.join(opts.docsDir, opts.flow);
  let raw: string;
  try {
    raw = await fs.readFile(path.join(flowDir, "annotations.json"), "utf8");
  } catch {
    throw new Error(`burnFlow: no annotations.json under ${flowDir}`);
  }
  const annFile = JSON.parse(raw) as AnnotationsFile;
  const byStep = new Map<string, AnnotationRecord[]>();
  for (const ann of annFile.annotations) {
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
        },
      });
      await fs.writeFile(dest, burned.png);
      reports.push(...burned.report);
    }
    written.push(file);
  }
  for (const step of byStep.keys()) {
    if (!burnedSteps.has(step)) {
      warn(`burn: step "${step}" has annotations but no screenshot — skipped`);
      reports.push(...byStep.get(step)!.map((a) => skippedReport(a, "no screenshot")));
    }
  }
  return { written, report: { flow: opts.flow, annotations: reports } };
}
