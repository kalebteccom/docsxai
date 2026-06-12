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
import { placeCallout, type Side } from "./placement.js";
import { measureText, parseFontMetrics, wrapText, type FontMetrics } from "./font-metrics.js";
import type { AnnotationRecord, AnnotationsFile } from "./annotations.js";

const ACCENT = "#e8590c";
const INK = "#1c1c1c";
const FONT_SIZE = 14;
const LINE_HEIGHT = 19;
const CALLOUT_PADDING_X = 11;
const CALLOUT_PADDING_Y = 8;
const CALLOUT_BORDER = 1;
/** Same outer-width clamp as the interactive overlay's measuring probe. */
const MAX_CALLOUT_WIDTH = 280;
const BADGE_INNER = 22;
const BADGE_BORDER = 2;
const BADGE_FONT_SIZE = 12;
const ARROW_HALF = 7;
const ARROW_LENGTH = 8;
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

export interface ArrowGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Triangle outline; the box is filled with INK and clipped to this shape. */
  clipPath: string;
}

/**
 * Triangle geometry for the callout arrow, tip at `tip` on the target's edge — the static mirror
 * of the viewer's `.sd-arrow.<side>` CSS triangles (7px half-base, 8px length). Satori renders
 * CSS border-triangles as filled boxes, so the burner clips an INK box to a polygon instead.
 */
export function arrowGeometry(side: Side, tip: { x: number; y: number }): ArrowGeometry {
  const base = ARROW_HALF * 2;
  switch (side) {
    case "top": // callout above → arrow points down
      return {
        left: tip.x - ARROW_HALF,
        top: tip.y - ARROW_LENGTH,
        width: base,
        height: ARROW_LENGTH,
        clipPath: "polygon(0% 0%, 100% 0%, 50% 100%)",
      };
    case "bottom": // callout below → arrow points up
      return {
        left: tip.x - ARROW_HALF,
        top: tip.y,
        width: base,
        height: ARROW_LENGTH,
        clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
      };
    case "left": // callout left → arrow points right
      return {
        left: tip.x - ARROW_LENGTH,
        top: tip.y - ARROW_HALF,
        width: ARROW_LENGTH,
        height: base,
        clipPath: "polygon(0% 0%, 100% 50%, 0% 100%)",
      };
    case "right": // callout right → arrow points left
      return {
        left: tip.x,
        top: tip.y - ARROW_HALF,
        width: ARROW_LENGTH,
        height: base,
        clipPath: "polygon(100% 0%, 100% 100%, 0% 50%)",
      };
  }
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

/** Builds the Satori element tree: the screenshot full-bleed, overlays absolutely positioned. */
export function buildBurnTree(input: BurnTreeInput): BurnNode {
  const { width, height } = input.image;
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

  for (const ann of input.annotations) {
    if (!ann.bounding_box) {
      warn(`burn: annotation on step "${ann.step}" has no bounding_box — skipped`);
      continue;
    }
    const t = ann.bounding_box;
    const label = (typeof ann.index === "number" ? `${ann.index}. ` : "") + ann.copy;

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

    if (ann.copy) {
      const contentMax = MAX_CALLOUT_WIDTH - 2 * (CALLOUT_PADDING_X + CALLOUT_BORDER);
      const lines = wrapText(label, FONT_SIZE, contentMax, input.metrics);
      const contentWidth = Math.min(
        Math.ceil(Math.max(...lines.map((l) => measureText(l, FONT_SIZE, input.metrics)))),
        contentMax,
      );
      const callout = {
        width: contentWidth + 2 * (CALLOUT_PADDING_X + CALLOUT_BORDER),
        height: lines.length * LINE_HEIGHT + 2 * (CALLOUT_PADDING_Y + CALLOUT_BORDER),
      };
      const p = placeCallout({
        image: { width, height },
        target: t,
        callout,
        preferred: preferredSide(ann.arrow_style),
      });
      // Nudge moves callout + arrow together; the halo stays on the target (same as the viewer).
      const nx = ann.nudge?.x ?? 0;
      const ny = ann.nudge?.y ?? 0;

      const arrow = arrowGeometry(p.side, p.arrow);
      children.push(
        div({
          position: "absolute",
          left: arrow.left + nx,
          top: arrow.top + ny,
          width: arrow.width,
          height: arrow.height,
          backgroundColor: INK,
          clipPath: arrow.clipPath,
        }),
        div(
          {
            position: "absolute",
            left: p.callout.x + nx,
            top: p.callout.y + ny,
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
            div(
              { height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px`, whiteSpace: "nowrap" },
              line,
            ),
          ),
        ),
      );
    }

    if (typeof ann.index === "number") {
      const text = String(ann.index);
      const badgeWidth = Math.max(
        BADGE_INNER + 2 * BADGE_BORDER,
        Math.ceil(measureText(text, BADGE_FONT_SIZE, input.metrics)) + 12 + 2 * BADGE_BORDER,
      );
      // Top-left of the halo, pulled slightly outside it; clamped to the image (viewer math).
      const bx = Math.max(0, Math.min(t.x - 8, width - BADGE_INNER));
      const by = Math.max(0, Math.min(t.y - 8, height - BADGE_INNER));
      children.push(
        div(
          {
            position: "absolute",
            left: bx,
            top: by,
            width: badgeWidth,
            height: BADGE_INNER + 2 * BADGE_BORDER,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: ACCENT,
            border: `${BADGE_BORDER}px solid #fff`,
            borderRadius: (BADGE_INNER + 2 * BADGE_BORDER) / 2,
            color: "#fff",
            fontSize: BADGE_FONT_SIZE,
          },
          text,
        ),
      );
    }
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
