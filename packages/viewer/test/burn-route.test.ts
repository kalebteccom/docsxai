// Connector routing for the line look. A themed caption whose straight line would cross text moves
// to a spot whose straight line crosses nothing, else gets one right-angle elbow, else keeps the
// spot it had. The fixtures under fixtures/remotxai/ copy a real capture's target and obstacle
// boxes (a 64 by 16 px pill boxed in by a title above, a status label to the right, an icon to the
// left and a chip row below); the screen is synthetic, with a text-like pattern in every listed box.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, renderBurn, type BurnNode, type CalloutTrace } from "../src/burn.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";
import { crossingLength, overlapArea } from "../src/obstacle-placement.js";
import { routeLine } from "../src/burn-route.js";
import { linePath } from "../src/burn-line.js";
import type { BurnTheme } from "../src/burn-theme.js";
import type { AnnotationRecord } from "../src/annotations.js";
import type { Rect } from "../src/placement.js";
import type { PixelGrid } from "../src/connector-contrast.js";
import { encodePng } from "./helpers/png.js";

const FIXTURES = new URL("./fixtures/remotxai/", import.meta.url);
const EXAMPLES = new URL("../../../examples/burn-theme/", import.meta.url);
const METRICS = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);

async function remotxaiDark(): Promise<BurnTheme> {
  const from = "remotxai-dark.tokens.json";
  const tokens = flattenTokens(JSON.parse(await fs.readFile(new URL(from, EXAMPLES), "utf8")));
  const config = parseThemeConfig({
    from,
    tokens: { scale: "render.scale", display_width: "render.display-width" },
  });
  return resolveBurnTheme(config, { workspace: EXAMPLES.pathname, tokens });
}

/** A dark screen with light stripes in every box. */
function screen(width: number, height: number, boxes: Rect[]): PixelGrid {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 14;
    rgba[i + 3] = 255;
  }
  for (const b of boxes) {
    for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(height, b.y + b.height); y++) {
      for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(width, b.x + b.width); x++) {
        if ((x + y) % 3 !== 0) continue;
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 220;
      }
    }
  }
  return { width, height, rgba };
}

type Pt = { x: number; y: number };

/** The polylines of every drawn line connector, read back from the SVG images in the tree. */
function drawnLines(tree: BurnNode): Pt[][] {
  const lines: Pt[][] = [];
  const visit = (n: BurnNode) => {
    const src = n.props.src;
    if (n.type === "img" && src?.startsWith("data:image/svg+xml;base64,")) {
      const svg = Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString("utf8");
      const d = /<path d="(M[^"]+)" fill="none"[^>]*stroke-linecap="butt"/.exec(svg)?.[1];
      const left = Number(n.props.style!.left);
      const top = Number(n.props.style!.top);
      if (d) {
        lines.push(
          [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => ({
            x: Number(m[1]) + left,
            y: Number(m[2]) + top,
          })),
        );
      }
    }
    if (Array.isArray(n.props.children)) n.props.children.forEach(visit);
  };
  visit(tree);
  return lines;
}

/** The listed boxes a polyline runs through, a 2 px wide stroke, brushes under 2 px not counted. */
function crossed(points: Pt[], boxes: Rect[]): Rect[] {
  return boxes.filter((b) =>
    points.slice(1).some((p, i) => {
      const a = points[i]!;
      const seg = {
        x: Math.min(a.x, p.x) - 1,
        y: Math.min(a.y, p.y) - 1,
        width: Math.abs(a.x - p.x) + 2,
        height: Math.abs(a.y - p.y) + 2,
      };
      return crossingLength(seg, [b]) > 0;
    }),
  );
}

const theme = await remotxaiDark();

describe.each(["en", "es"])("remotxai yolo-enabled, %s, 1280", (locale) => {
  it("routes the line around the listed text and keeps the caption clear", async () => {
    const doc = JSON.parse(
      await fs.readFile(new URL(`yolo-enabled.${locale}.dark.1280.json`, FIXTURES), "utf8"),
    );
    const records = doc.annotations as AnnotationRecord[];
    const { width, height } = doc.viewport as { width: number; height: number };
    const listed = records.flatMap((r) => r.obstacles ?? []);
    const report: AnnotationReport[] = [];
    const trace: CalloutTrace[] = [];
    const tree = buildBurnTree({
      image: { width, height, dataUri: "data:image/png;base64," },
      annotations: records,
      metrics: METRICS,
      theme: { ...theme, captionStyle: "full" },
      pixels: screen(width, height, listed),
      report,
      trace,
      warn: () => {},
    });
    const lines = drawnLines(tree);
    expect(lines).toHaveLength(1);
    expect(crossed(lines[0]!, listed)).toEqual([]);
    const caption = report[0]!.callout!;
    expect(listed.reduce((n, o) => n + overlapArea(caption, o), 0)).toBe(0);
    expect(report[0]!.route).toMatch(/^(straight|elbow)$/);
    expect(report[0]!.connector_crossings).toBe(0);
    // One right angle at most: a straight line has 2 points, an elbow 3.
    expect(lines[0]!.length).toBeLessThanOrEqual(3);
  });
});

describe("routeLine", () => {
  const image = { width: 600, height: 400 };
  const target = { x: 280, y: 190, width: 40, height: 20 };
  const size = { width: 120, height: 40 };
  const base = {
    target,
    image,
    size,
    blockers: [] as Rect[],
    forbid: [] as Rect[],
    preferred: "top" as const,
    hinted: false,
    nudge: { x: 0, y: 0 },
    inset: 10,
  };

  it("keeps a clean hinted side", () => {
    const r = routeLine({ ...base, preferred: "left", hinted: true })!;
    expect(r.kind).toBe("straight");
    expect(r.side).toBe("left");
  });

  it("takes the shortest clean straight line when the hinted side crosses text", () => {
    // A label just right of the target blocks the right side; the other sides are clear.
    const label = { x: 330, y: 185, width: 60, height: 30 };
    const r = routeLine({ ...base, preferred: "right", hinted: true, blockers: [label] })!;
    expect(r.kind).toBe("straight");
    expect(r.side).not.toBe("right");
  });

  it("bends once when every straight line crosses text", () => {
    // Text hugs all four sides of the target, 6 px off; a corridor stays open past its corners.
    const ring = [
      { x: 270, y: 160, width: 60, height: 16 }, // above
      { x: 270, y: 224, width: 60, height: 16 }, // below
      { x: 240, y: 188, width: 26, height: 24 }, // left
      { x: 334, y: 188, width: 26, height: 24 }, // right
    ];
    const r = routeLine({ ...base, blockers: ring })!;
    expect(r.kind).toBe("elbow");
    const p = linePath(r.layout, 10, 5)!;
    expect(p.points).toHaveLength(3);
    const [a, b, c] = p.points as [Pt, Pt, Pt];
    // One right angle: the first leg is axis-aligned, the second along the other axis.
    expect(a.x === b.x || a.y === b.y).toBe(true);
    expect(b.x === c.x || b.y === c.y).toBe(true);
    expect(a.x === b.x).not.toBe(b.x === c.x);
    expect(crossed(p.points, ring)).toEqual([]);
  });

  it("gives up when the target is boxed in", () => {
    // The target sits inside the box: no line can leave it without crossing.
    const box = { x: 250, y: 160, width: 100, height: 80 };
    expect(routeLine({ ...base, blockers: [box] })).toBeNull();
  });
});

it("renders the routed frame from a PNG and reports the route", async () => {
  const doc = JSON.parse(
    await fs.readFile(new URL("yolo-enabled.en.dark.1280.json", FIXTURES), "utf8"),
  );
  const records = doc.annotations as AnnotationRecord[];
  const grid = screen(
    1280,
    800,
    records.flatMap((r) => r.obstacles ?? []),
  );
  const png = encodePng(grid.rgba, 1280, 800);
  const { report } = await renderBurn({
    screenshotBuffer: png,
    annotations: records,
    options: { theme: { ...theme, captionStyle: "full" }, warn: () => {} },
  });
  expect(report[0]!.connector_crossings).toBe(0);
  expect(report[0]!.route).toMatch(/^(straight|elbow)$/);
});
