// Captions burned on real capture sidecars (fixtures/trackxai: a dense app at 1280 and 390, the
// boxes as the capture listed them) must cover no listed text and no other annotation's target,
// caption or badge, and on a phone capture neither the header nor the bottom nav. Each badge sits
// next to its target, off it, off listed text and off the phone chrome. On a phone capture no
// connector line crosses listed text. On every capture no connector line runs behind another
// annotation's caption or badge.
// Margins, in CSS px: a badge keeps 6 off every image edge, 12 off the sides of a desktop capture
// and 6 off a full-height page divider (the sidebar's edge). A desktop caption keeps 12 off the
// sides. Phone frames also run at 2x, as the landing captures them.
// The screenshot is synthetic: dark, with a text-like stripe pattern in every listed box, so the
// pixel checks see the same text the sidecar names, and on a desktop capture a sidebar edge.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree, type CalloutTrace } from "../src/burn.js";
import type { AnnotationReport } from "../src/burn-report.js";
import { layoutAtScale } from "../src/burn-scale.js";
import { linePath } from "../src/burn-line.js";
import { RING_OUTSET } from "../src/burn-clean.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";
import { crossingLength, overlapArea } from "../src/obstacle-placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import type { Rect } from "../src/placement.js";
import type { PixelGrid } from "../src/connector-contrast.js";

const FIXTURES = new URL("./fixtures/trackxai/", import.meta.url);
const EXAMPLES = new URL("../../../examples/burn-theme/", import.meta.url);

async function darkTheme() {
  const from = "trackxai-dark.tokens.json";
  const tokens = flattenTokens(JSON.parse(await fs.readFile(new URL(from, EXAMPLES), "utf8")));
  const config = parseThemeConfig({
    from,
    tokens: { scale: "render.scale", display_width: "render.display-width" },
  });
  return resolveBurnTheme(config, { workspace: EXAMPLES.pathname, tokens });
}

const METRICS = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);

/** Where a desktop capture's sidebar ends: a lighter page and a 1 px border from here, CSS px. */
const SIDEBAR_EDGE = 247;
/** Margins in CSS px, see the header. */
const BADGE_EDGE = 6;
const SIDE_GAP = 12;
const DIVIDER_GAP = 6;

/** A dark screen with light stripes in every box, and on a desktop capture a sidebar edge. */
function screen(width: number, height: number, boxes: Rect[], pr: number): PixelGrid {
  const rgba = new Uint8Array(width * height * 4);
  const edge = width / pr >= 900 ? SIDEBAR_EDGE * pr : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = x < edge ? 14 : x < edge + pr ? 60 : 22;
      rgba[i + 3] = 255;
    }
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

/** Px between two boxes that do not overlap: 0 when they touch. */
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * Text the real page draws that a sidecar's capped obstacle list leaves out, painted into the
 * synthetic screen too: the board's cards, which captions and connectors must not run through.
 */
const UNLISTED_TEXT: Record<string, Rect[]> = {
  "board.en.dark.1280.json": [{ x: 280, y: 262, width: 968, height: 538 }],
};

const grow = (r: Rect, k: number): Rect => ({
  x: r.x * k,
  y: r.y * k,
  width: r.width * k,
  height: r.height * k,
});

const names = (await fs.readdir(FIXTURES)).filter((f) => f.endsWith(".json")).sort();
const cases = names.flatMap((file) => {
  const phone = file.endsWith(".390.json");
  return (phone ? [1, 2] : [1]).map((pr) => ({ file, pr, label: `${file} at ${pr}x` }));
});
const theme = await darkTheme();

describe.each(cases)("$label", ({ file, pr }) => {
  it("burns captions clear of listed text, targets, captions and badges", async () => {
    const doc = JSON.parse(await fs.readFile(new URL(file, FIXTURES), "utf8"));
    const records = (doc.annotations as AnnotationRecord[]).map((r) => ({
      ...r,
      ...(r.bounding_box ? { bounding_box: grow(r.bounding_box, pr) } : {}),
      ...(r.obstacles ? { obstacles: r.obstacles.map((o) => grow(o, pr)) } : {}),
    }));
    const css = doc.viewport as { width: number; height: number };
    const width = css.width * pr;
    const height = css.height * pr;
    const desktop = css.width >= 900;
    const listed = records.flatMap((r) => r.obstacles ?? []);
    // As the landing burns them: the default `auto` falls back to a badge where no caption spot is clear.
    const report: AnnotationReport[] = [];
    const trace: CalloutTrace[] = [];
    buildBurnTree({
      image: { width, height, dataUri: "data:image/png;base64," },
      annotations: records,
      metrics: METRICS,
      theme,
      pixelRatio: pr,
      pixels: screen(
        width,
        height,
        [...listed, ...(UNLISTED_TEXT[file] ?? []).map((b) => grow(b, pr))],
        pr,
      ),
      report,
      trace,
      warn: () => {},
    });
    // The phone header and bottom nav, which captions and badges keep off.
    const bands = desktop
      ? []
      : [
          { name: "the header", box: { x: 0, y: 0, width, height: 56 * pr } },
          { name: "the bottom nav", box: { x: 0, y: height - 56 * pr, width, height: 56 * pr } },
        ];
    const problems: string[] = [];
    report.forEach((r, i) => {
      const c = r.callout;
      if (!c) return;
      const name = `caption ${records[i]!.index ?? i + 1}`;
      for (const b of bands)
        if (overlapArea(c, b.box) > 0) problems.push(`${name} is on ${b.name}`);
      const text = (records[i]!.obstacles ?? []).reduce((n, o) => n + overlapArea(c, o), 0);
      if (text > 0) problems.push(`${name} covers ${Math.round(text)} px² of listed text`);
      records.forEach((other, j) => {
        if (j === i) return;
        if (other.bounding_box && overlapArea(c, other.bounding_box) > 0) {
          problems.push(`${name} covers target ${j + 1}`);
        }
        const oc = report[j]?.callout;
        if (oc && overlapArea(c, oc) > 0) problems.push(`${name} overlaps caption ${j + 1}`);
      });
      report.forEach((o, j) => {
        if (o.badge && overlapArea(c, o.badge) > 0) problems.push(`${name} covers badge ${j + 1}`);
      });
      if (desktop && (c.x < SIDE_GAP * pr || width - (c.x + c.width) < SIDE_GAP * pr)) {
        problems.push(`${name} is within ${SIDE_GAP} px of the side`);
      }
    });
    // On a phone capture a connector's stem may not cross listed text: it would run through a label.
    // Desktop captures keep full captions and are not held to this.
    for (const t of desktop ? [] : trace) {
      const stem = layoutAtScale(t.layout, t.scale).stem;
      if (!stem) continue;
      const crossed = crossingLength(stem, records[t.position]!.obstacles ?? []);
      if (crossed > 0) {
        problems.push(
          `caption ${records[t.position]!.index ?? t.position + 1}'s line crosses text`,
        );
      }
    }
    // No connector line runs behind another annotation's caption or badge.
    for (const t of trace) {
      const path = linePath(layoutAtScale(t.layout, t.scale), 8 * t.scale, RING_OUTSET * t.scale);
      if (!path) continue;
      const segs = path.points.slice(1).map((q, k) => {
        const a = path.points[k]!;
        return {
          x: Math.min(a.x, q.x) - 1,
          y: Math.min(a.y, q.y) - 1,
          width: Math.abs(a.x - q.x) + 2,
          height: Math.abs(a.y - q.y) + 2,
        };
      });
      report.forEach((o, j) => {
        if (j === t.position) return;
        const behind = (box: Rect | undefined) => box && segs.some((s) => overlapArea(s, box) > 0);
        if (behind(o.callout)) problems.push(`line ${t.position + 1} runs behind caption ${j + 1}`);
        if (behind(o.badge)) problems.push(`line ${t.position + 1} runs behind badge ${j + 1}`);
      });
    }
    report.forEach((r, i) => {
      const t = records[i]!.bounding_box;
      const b = r.badge;
      if (!b || !t) return;
      if (overlapArea(b, t) > 0) problems.push(`badge ${i + 1} is on its target`);
      for (const band of bands) {
        if (overlapArea(b, band.box) > 0) problems.push(`badge ${i + 1} is on ${band.name}`);
      }
      const text = (records[i]!.obstacles ?? []).reduce((n, o) => n + overlapArea(b, o), 0);
      if (text > 0) problems.push(`badge ${i + 1} covers ${Math.round(text)} px² of listed text`);
      if (gap(b, t) > 6 * pr)
        problems.push(`badge ${i + 1} is ${gap(b, t) / pr} px from its target`);
      const side = (desktop ? SIDE_GAP : BADGE_EDGE) * pr;
      const edge = BADGE_EDGE * pr;
      const margins = [
        b.x - side,
        width - (b.x + b.width) - side,
        b.y - edge,
        height - (b.y + b.height) - edge,
      ];
      if (margins.some((m) => m < -0.05)) {
        problems.push(
          `badge ${i + 1} is within ${BADGE_EDGE} px of the image edge (${b.x / pr}, ${b.y / pr})`,
        );
      }
      if (desktop) {
        const divider = SIDEBAR_EDGE * pr;
        const near =
          b.x + b.width > divider - DIVIDER_GAP * pr && b.x < divider + (1 + DIVIDER_GAP) * pr;
        if (near) problems.push(`badge ${i + 1} sits on the page divider`);
      }
    });
    expect(problems).toEqual([]);
  });
});
