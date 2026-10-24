// Captions burned on real capture sidecars (fixtures/trackxai: a dense app at 1280 and 390, the
// boxes as the capture listed them) must cover no listed text and no other annotation's target,
// caption or badge, and each badge must sit at its target's corner, outside it and next to it.
// The screenshot is synthetic: dark, with a text-like stripe pattern in every listed box, so the
// pixel checks see the same text the sidecar names.

import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderBurn } from "../src/burn.js";
import { parseThemeConfig, resolveBurnTheme } from "../src/burn-theme-config.js";
import { flattenTokens } from "../src/burn-theme-tokens.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { AnnotationRecord } from "../src/annotations.js";
import type { Rect } from "../src/placement.js";
import { encodePng } from "./helpers/png.js";

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

/** A dark screen with light stripes in every box. */
function screen(width: number, height: number, boxes: Rect[]): Buffer {
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
  return encodePng(rgba, width, height);
}

/** Px between two boxes that do not overlap: 0 when they touch. */
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * Covers the burner cannot avoid today, listed so a new one fails the test and a fixed one does
 * too (then delete its entry). Both are phone captures where no strip within 45% of the screen
 * height fits the caption, even one-line and one text step smaller.
 */
const KNOWN: Record<string, string[]> = {
  // The title sits between the header icons and the tabs; the strip right of it is 57 px tall.
  "board.en.dark.390.json": ["caption 1 covers 75 px² of listed text"],
  // Header and title fill the top; the caption docks over the header's edge.
  "ticket.en.dark.390.json": ["caption 1 covers 116 px² of listed text"],
};

const files = (await fs.readdir(FIXTURES)).filter((f) => f.endsWith(".json")).sort();
const theme = await darkTheme();

describe.each(files)("%s", (file) => {
  it("burns captions clear of listed text, targets, captions and badges", async () => {
    const doc = JSON.parse(await fs.readFile(new URL(file, FIXTURES), "utf8"));
    const records = doc.annotations as AnnotationRecord[];
    const { width, height } = doc.viewport as { width: number; height: number };
    const listed = records.flatMap((r) => r.obstacles ?? []);
    const { report } = await renderBurn({
      screenshotBuffer: screen(width, height, listed),
      annotations: records,
      options: { theme, warn: () => {} },
    });
    const problems: string[] = [];
    report.forEach((r, i) => {
      const c = r.callout;
      if (!c) return;
      const name = `caption ${records[i]!.index ?? i + 1}`;
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
    });
    report.forEach((r, i) => {
      const t = records[i]!.bounding_box;
      if (!r.badge || !t) return;
      if (overlapArea(r.badge, t) > 0) problems.push(`badge ${i + 1} is on its target`);
      if (gap(r.badge, t) > 6)
        problems.push(`badge ${i + 1} is ${gap(r.badge, t)} px from its target`);
    });
    expect(problems).toEqual(KNOWN[file] ?? []);
  });
});
