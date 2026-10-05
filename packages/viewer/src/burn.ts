// Durable burned-annotation renderer — bakes halo + badge + callout + arrow into the PNG for
// delivery surfaces that can't run the interactive viewer (Confluence, Notion, plain wikis).
//
// Browser-free by design: no Chromium, no playwright, no DOM. The pipeline is
// Satori (flexbox-subset layout → SVG) → resvg (SVG → PNG). The clean screenshot is embedded in
// the Satori tree as a data-URI <img>, so the whole frame rasterises in a single resvg pass —
// one encoder produces every output byte, there is no separate composite/re-encode step, and the
// output is byte-stable across runs: Satori layout and resvg rasterisation are pure functions of
// their inputs, the only font is the vendored Inter (system fonts are not loaded), text becomes
// glyph paths inside the SVG, and resvg's PNG encoder writes no timestamps.
//
// Placement reuses the interactive overlay's `placeCallout` (placement.ts) in screenshot pixel
// space; text sizing uses the vendored font's own metrics (font-metrics.ts) instead of the
// overlay's DOM probe. Visual constants mirror the viewer CSS in render.ts.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { placeCallout, type Rect, type Side } from "./placement.js";
import { planCallout } from "./obstacle-placement.js";
import { anchorBadge, planBadge, BADGE_DEFAULT_OFFSET, BADGE_INNER } from "./badge-placement.js";
import { arrowGeometry, type ArrowGeometry } from "./arrow.js";
import { measureText, parseFontMetrics, wrapText, type FontMetrics } from "./font-metrics.js";
import type { AnnotationRecord, AnnotationsFile, BoundingBox } from "./annotations.js";

export { arrowGeometry, type ArrowGeometry };

const ACCENT = "#e8590c";
const INK = "#1c1c1c";
const FONT_SIZE = 14;
const LINE_HEIGHT = 19;
const CALLOUT_PADDING_X = 11;
const CALLOUT_PADDING_Y = 8;
const CALLOUT_BORDER = 1;
/** Same outer-width clamp as the interactive overlay's measuring probe. */
const MAX_CALLOUT_WIDTH = 280;
const BADGE_BORDER = 2;
const BADGE_FONT_SIZE = 12;
/** Margin of the keep-clear box around another annotation's halo (border + glow + slack). */
const HALO_MARGIN = 6;
const SIDES: readonly string[] = ["top", "bottom", "left", "right"];

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

function preferredSide(arrowStyle: string | undefined): Side {
  const pref = (arrowStyle ?? "top").split("-")[0] ?? "top";
  return SIDES.includes(pref) ? (pref as Side) : "top";
}

function div(style: Record<string, string | number>, children?: BurnNode[] | string): BurnNode {
  return { type: "div", props: { style, ...(children !== undefined ? { children } : {}) } };
}

export interface BurnTreeInput {
  image: { width: number; height: number; dataUri: string };
  annotations: AnnotationRecord[];
  metrics: FontMetrics;
  warn?: Warn;
}

type Size = { width: number; height: number };

/** Wraps the callout copy to the 280px clamp and sizes the box around it. */
function measureCallout(label: string, metrics: FontMetrics): { lines: string[]; size: Size } {
  const contentMax = MAX_CALLOUT_WIDTH - 2 * (CALLOUT_PADDING_X + CALLOUT_BORDER);
  const lines = wrapText(label, FONT_SIZE, contentMax, metrics);
  const contentWidth = Math.min(
    Math.ceil(Math.max(...lines.map((l) => measureText(l, FONT_SIZE, metrics)))),
    contentMax,
  );
  return {
    lines,
    size: {
      width: contentWidth + 2 * (CALLOUT_PADDING_X + CALLOUT_BORDER),
      height: lines.length * LINE_HEIGHT + 2 * (CALLOUT_PADDING_Y + CALLOUT_BORDER),
    },
  };
}

/** Outer size of the numbered badge: the circle widens for multi-digit indexes. */
function badgeSize(index: number, metrics: FontMetrics): Size {
  return {
    width: Math.max(
      BADGE_INNER + 2 * BADGE_BORDER,
      Math.ceil(measureText(String(index), BADGE_FONT_SIZE, metrics)) + 12 + 2 * BADGE_BORDER,
    ),
    height: BADGE_INNER + 2 * BADGE_BORDER,
  };
}

/** Default box of the numbered badge: top-left of the halo, pulled slightly outside it, clamped to the image. */
function badgeBox(t: BoundingBox, index: number, image: Size, metrics: FontMetrics): Rect {
  return anchorBadge(t, "top-left", BADGE_DEFAULT_OFFSET, badgeSize(index, metrics), image);
}

const inflate = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  width: r.width + 2 * m,
  height: r.height + 2 * m,
});

/** Keep-clear boxes around every other annotation's halo. */
function otherHalos(annotations: AnnotationRecord[], self: AnnotationRecord): Rect[] {
  return annotations.flatMap((other) =>
    other !== self && other.bounding_box ? [inflate(other.bounding_box, HALO_MARGIN)] : [],
  );
}

/**
 * What an annotation's callout must stay clear of besides page content: halos, badges, earlier
 * callouts. Badges already planned stand where they were put; the rest at their default spot.
 */
function keepClear(
  annotations: AnnotationRecord[],
  self: AnnotationRecord,
  image: Size,
  metrics: FontMetrics,
  placed: Rect[],
  badges: Map<AnnotationRecord, Rect>,
): Rect[] {
  const clear: Rect[] = [];
  for (const other of annotations) {
    const box = other.bounding_box;
    if (!box) continue;
    if (other !== self) clear.push(inflate(box, HALO_MARGIN));
    if (typeof other.index === "number") {
      clear.push(badges.get(other) ?? badgeBox(box, other.index, image, metrics));
    }
  }
  return [...clear, ...placed];
}

interface DrawnCallout {
  nodes: BurnNode[];
  /** Boxes the callout, arrow and stem occupy (nudge applied), for later annotations to avoid. */
  boxes: Rect[];
}

function calloutNodes(
  ann: AnnotationRecord,
  t: BoundingBox,
  image: Size,
  metrics: FontMetrics,
  clear: Rect[],
): DrawnCallout {
  const label = (typeof ann.index === "number" ? `${ann.index}. ` : "") + ann.copy;
  const { lines, size: callout } = measureCallout(label, metrics);
  // Nudge moves callout + arrow together; the halo stays on the target (same as the viewer).
  const nudge = { x: ann.nudge?.x ?? 0, y: ann.nudge?.y ?? 0 };
  const input = { image, target: t, callout, preferred: preferredSide(ann.arrow_style) };
  const p = ann.obstacles?.length
    ? planCallout({ ...input, obstacles: ann.obstacles, avoid: clear, nudge })
    : { ...placeCallout(input), stem: null };

  const arrow = arrowGeometry(p.side, p.arrow);
  const stem = p.stem;
  const arrowBox = { x: arrow.left, y: arrow.top, width: arrow.width, height: arrow.height };
  const calloutBox = { x: p.callout.x, y: p.callout.y, ...callout };
  const nodes: BurnNode[] = [];
  if (stem) {
    nodes.push(
      div({
        position: "absolute",
        left: stem.x + nudge.x,
        top: stem.y + nudge.y,
        width: stem.width,
        height: stem.height,
        backgroundColor: INK,
      }),
    );
  }
  nodes.push(
    div({
      position: "absolute",
      left: arrow.left + nudge.x,
      top: arrow.top + nudge.y,
      width: arrow.width,
      height: arrow.height,
      backgroundColor: INK,
      clipPath: arrow.clipPath,
    }),
    div(
      {
        position: "absolute",
        left: p.callout.x + nudge.x,
        top: p.callout.y + nudge.y,
        width: callout.width,
        height: callout.height,
        display: "flex",
        flexDirection: "column",
        paddingTop: CALLOUT_PADDING_Y,
        paddingBottom: CALLOUT_PADDING_Y,
        paddingLeft: CALLOUT_PADDING_X,
        paddingRight: CALLOUT_PADDING_X,
        backgroundColor: "#fff",
        border: `${CALLOUT_BORDER}px solid ${INK}`,
        borderRadius: 7,
        color: INK,
        fontSize: FONT_SIZE,
      },
      lines.map((line) =>
        div({ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, whiteSpace: "nowrap" }, line),
      ),
    ),
  );
  const boxes = [calloutBox, arrowBox, ...(stem ? [stem] : [])].map((r) => ({
    ...r,
    x: r.x + nudge.x,
    y: r.y + nudge.y,
  }));
  return { nodes, boxes };
}

function badgeNode(box: Rect, index: number): BurnNode {
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
      backgroundColor: ACCENT,
      border: `${BADGE_BORDER}px solid #fff`,
      borderRadius: box.height / 2,
      color: "#fff",
      fontSize: BADGE_FONT_SIZE,
    },
    String(index),
  );
}

/** Builds the Satori element tree: the screenshot full-bleed, overlays absolutely positioned. */
export function buildBurnTree(input: BurnTreeInput): BurnNode {
  const { width, height } = input.image;
  const image = { width, height };
  const warn = input.warn ?? defaultWarn;
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

  for (const ann of input.annotations) {
    if (!ann.bounding_box) {
      warn(`burn: annotation on step "${ann.step}" has no bounding_box — skipped`);
      continue;
    }
    const t = ann.bounding_box;
    children.push(
      div({
        position: "absolute",
        left: t.x,
        top: t.y,
        width: t.width,
        height: t.height,
        border: `2px solid ${ACCENT}`,
        borderRadius: 4,
        boxShadow: "0 0 0 3px rgba(232,89,12,0.35)",
      }),
    );

    // The badge goes first so this annotation's callout and later ones keep clear of where it landed.
    const badge =
      typeof ann.index === "number"
        ? ann.obstacles?.length
          ? planBadge({
              image,
              target: t,
              size: badgeSize(ann.index, input.metrics),
              obstacles: ann.obstacles,
              avoid: [...otherHalos(input.annotations, ann), ...placed, ...badges.values()],
            })
          : badgeBox(t, ann.index, image, input.metrics)
        : undefined;
    if (badge) badges.set(ann, badge);

    if (ann.copy) {
      const clear = keepClear(input.annotations, ann, image, input.metrics, placed, badges);
      const drawn = calloutNodes(ann, t, image, input.metrics, clear);
      children.push(...drawn.nodes);
      placed.push(...drawn.boxes);
    }

    if (badge && typeof ann.index === "number") children.push(badgeNode(badge, ann.index));
  }

  return div(
    { position: "relative", display: "flex", width, height, fontFamily: "Inter" },
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
  /** Receives skip warnings (default: console.warn). */
  warn?: Warn;
}

export interface BurnInput {
  screenshotPath?: string;
  screenshotBuffer?: Buffer;
  /** `docsxai/annotations@1`-shaped records for ONE screenshot. */
  annotations: AnnotationRecord[];
  options?: BurnOptions;
}

/** Renders `annotations` onto the screenshot; returns the burned PNG (byte-stable across runs). */
export async function burnAnnotations(input: BurnInput): Promise<Buffer> {
  const screenshot =
    input.screenshotBuffer ??
    (input.screenshotPath !== undefined ? await fs.readFile(input.screenshotPath) : undefined);
  if (!screenshot) {
    throw new Error("burnAnnotations: provide screenshotPath or screenshotBuffer");
  }
  const { width, height } = pngDimensions(screenshot);
  const font = await loadFont();
  const tree = buildBurnTree({
    image: { width, height, dataUri: `data:image/png;base64,${screenshot.toString("base64")}` },
    annotations: input.annotations,
    metrics: font.metrics,
    ...(input.options?.warn ? { warn: input.options.warn } : {}),
  });
  const svg = await satori(tree, {
    width,
    height,
    fonts: [{ name: "Inter", data: font.data, weight: 400, style: "normal" }],
  });
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}

export interface BurnFlowOptions {
  /** The doc pack's `docs/` directory. */
  docsDir: string;
  flow: string;
  /** Default: `<docsDir>/<flow>/burned`. */
  outDir?: string;
  warn?: Warn;
}

export interface BurnFlowResult {
  /** PNG filenames written under `outDir`, sorted. */
  written: string[];
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
  const burnedSteps = new Set<string>();
  for (const file of shots) {
    const step = file.replace(/\.png$/, "");
    burnedSteps.add(step);
    const annotations = byStep.get(step) ?? [];
    const dest = path.join(outDir, file);
    if (annotations.length === 0) {
      await fs.copyFile(path.join(shotsDir, file), dest);
    } else {
      const burned = await burnAnnotations({
        screenshotPath: path.join(shotsDir, file),
        annotations,
        options: { warn },
      });
      await fs.writeFile(dest, burned);
    }
    written.push(file);
  }
  for (const step of byStep.keys()) {
    if (!burnedSteps.has(step)) {
      warn(`burn: step "${step}" has annotations but no screenshot — skipped`);
    }
  }
  return { written };
}
