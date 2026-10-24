import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { arrowGeometry } from "../src/arrow.js";
import { planBadge } from "../src/badge-placement.js";
import {
  DEFAULT_CALLOUT_STYLE,
  layoutBoxes,
  layoutCallout,
  measureCallout,
} from "../src/burn-callout.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import {
  crossingLength,
  overlapArea,
  planCallout,
  scorePlacement,
} from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";

const METRICS = parseFontMetrics(
  await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url)),
);
const callout = { width: 100, height: 40 };

describe("a hinted side wins over a slightly cheaper one", () => {
  // Target with room on one side and a sliver of content on it, a different side with a sliver
  // less. Without the hint the cheaper side wins; with it, the hinted one does.
  const bottomScene = {
    image: { width: 400, height: 800 },
    target: { x: 100, y: 300, width: 200, height: 40 },
    callout,
    preferred: "bottom" as const,
    // 2 px of the bottom callout sit in the wall below;
    // the top callout touches 1 px of the wall above
    obstacles: [
      { x: 0, y: 388, width: 400, height: 412 },
      { x: 0, y: 0, width: 400, height: 251 },
    ],
  };
  const leftScene = {
    image: { width: 800, height: 400 },
    target: { x: 300, y: 100, width: 40, height: 200 },
    callout,
    preferred: "left" as const,
    // 2 px of the left callout sits in the wall to its left; the right one touches 1 px
    obstacles: [
      { x: 0, y: 0, width: 192, height: 400 },
      { x: 449, y: 0, width: 351, height: 400 },
      { x: 0, y: 0, width: 800, height: 91 },
      { x: 0, y: 300, width: 800, height: 100 },
    ],
  };

  it.each([
    ["bottom", bottomScene, "top"],
    ["left", leftScene, "right"],
  ] as const)("keeps the hinted %s side", (side, scene, cheaper) => {
    expect(planCallout(scene).side).toBe(cheaper);
    const hinted = planCallout({ ...scene, hinted: true });
    expect(hinted.side).toBe(side);
    expect(hinted.distance).toBe(10);
  });

  it("gives the hint up when its callout sits deep in content", () => {
    const deep = {
      ...bottomScene,
      obstacles: [{ x: 0, y: 380, width: 400, height: 420 }, bottomScene.obstacles[1]!],
    };
    expect(planCallout({ ...deep, hinted: true }).side).toBe("top");
  });

  it("is a no-op when the hinted side has no room in the image", () => {
    const edge = {
      ...bottomScene,
      target: { x: 100, y: 20, width: 200, height: 40 },
      preferred: "top" as const,
    };
    expect(planCallout({ ...edge, hinted: true }).side).not.toBe("top");
  });
});

describe("a stem is charged for the content it crosses", () => {
  const stem = { x: 140, y: 140, width: 2, height: 100 };
  const box = { callout: { x: 100, y: 100, width: 100, height: 40 }, connector: [stem] };
  const ctx = { image: { width: 400, height: 400 }, avoid: [] as Rect[] };

  it("measures the stretch of stem inside a box, ignoring a brush of its edge", () => {
    expect(crossingLength(stem, [{ x: 100, y: 170, width: 100, height: 16 }])).toBe(12);
    expect(crossingLength(stem, [{ x: 100, y: 170, width: 100, height: 4 }])).toBe(0);
    expect(crossingLength(stem, [{ x: 300, y: 170, width: 100, height: 16 }])).toBe(0);
    const flat = { x: 0, y: 100, width: 200, height: 2 };
    expect(crossingLength(flat, [{ x: 50, y: 90, width: 40, height: 30 }])).toBe(36);
  });

  it("adds that stretch to the cost of the placement", () => {
    const row = { x: 100, y: 170, width: 100, height: 16 };
    const plain = scorePlacement(box, { ...ctx, obstacles: [row] });
    const counted = scorePlacement({ ...box, stem }, { ...ctx, obstacles: [row] });
    expect(counted.cost - plain.cost).toBeGreaterThanOrEqual(12 * 100);
    expect(counted.overlap).toBe(plain.overlap);
  });

  it("stays near the target and covers a few px of text before a stem runs through six rows", () => {
    const image = { width: 400, height: 800 };
    const target = { x: 20, y: 300, width: 360, height: 40 };
    const rows = Array.from({ length: 6 }, (_, i) => ({
      x: 20,
      y: 360 + 30 * i,
      width: 360,
      height: 16,
    }));
    const wall = { x: 0, y: 0, width: 400, height: 254 }; // 4 px of the top callout's spot
    const p = planCallout({
      image,
      target,
      callout: { width: 120, height: 40 },
      preferred: "top",
      obstacles: [wall, ...rows],
    });
    const a = arrowGeometry(p.side, p.arrow);
    const connector = [
      { x: a.left, y: a.top, width: a.width, height: a.height },
      ...(p.stem ? [p.stem] : []),
    ];
    expect(p.side).toBe("top");
    expect(p.stem).toBeNull();
    for (const r of rows) expect(connector.reduce((n, c) => n + overlapArea(c, r), 0)).toBe(0);
  });
});

describe("badge stays inside the image", () => {
  const image = { width: 390, height: 780 };
  const size = { width: 28, height: 28 };
  const inside = (b: Rect) => {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(image.width);
    expect(b.y + b.height).toBeLessThanOrEqual(image.height);
  };

  it("keeps the whole badge above the bottom edge when its corner is pushed down", () => {
    const target = { x: 16, y: 712, width: 358, height: 44 };
    // text above both top corners, so the planner takes a bottom one
    const obstacles = [{ x: 0, y: 660, width: 390, height: 52 }];
    const box = planBadge({ image, target, size, obstacles });
    inside(box);
    expect(box.y).toBeGreaterThan(target.y);
  });

  it("keeps it inside on the right edge as well, with a margin", () => {
    const target = { x: 340, y: 100, width: 48, height: 30 };
    // text above and to the left, so the planner takes a bottom-right corner
    const obstacles = [
      { x: 300, y: 60, width: 90, height: 40 },
      { x: 240, y: 100, width: 98, height: 80 },
    ];
    const box = planBadge({ image, target, size, obstacles });
    inside(box);
    expect(box.x + box.width).toBeLessThanOrEqual(image.width - 2);
  });
});

describe("layoutCallout", () => {
  const image = { width: 390, height: 780 };
  const lay = (a: AnnotationRecord) =>
    layoutCallout({ ann: a, target: a.bounding_box!, image, metrics: METRICS, clear: [] });
  const base = (overrides: Partial<AnnotationRecord>): AnnotationRecord => ({
    step: "s",
    selector: "#x",
    copy: "Hi",
    ...overrides,
  });

  it("treats arrow_style as a hint that beats a sliver of overlap", () => {
    const target = { x: 20, y: 400, width: 350, height: 44 };
    const l = lay(
      base({
        bounding_box: target,
        arrow_style: "bottom",
        // 3 px of the callout below sit in the wall; 1 px of a callout above would
        obstacles: [
          { x: 0, y: 488, width: 390, height: 292 },
          { x: 0, y: 0, width: 390, height: 354 },
        ],
      }),
    );
    expect(l.side).toBe("bottom");
  });

  it("squeezes the side padding to fit a gap the full box overruns by a few px", () => {
    const target = { x: 20, y: 400, width: 44, height: 44 };
    const text = "Attach a file";
    const natural = measureCallout(text, METRICS, 242).size.width;
    const squeezed = measureCallout(text, METRICS, 242, {
      ...DEFAULT_CALLOUT_STYLE,
      paddingX: 8,
    }).size.width;
    expect(squeezed).toBe(natural - 6);
    const around = (overrun: number): Rect[] => {
      const x = target.x + target.width + 10 + natural - overrun;
      return [
        { x, y: 0, width: image.width - x, height: image.height },
        { x: 0, y: 0, width: image.width, height: 395 },
        { x: 0, y: 449, width: image.width, height: 331 },
      ];
    };
    const fits = lay(base({ copy: text, bounding_box: target, obstacles: around(5) }));
    expect(fits.side).toBe("right");
    expect(fits.paddingX).toBe(8);
    expect(fits.obstacleOverlap).toBe(0);
    expect(layoutBoxes(fits)[0]!.width).toBe(squeezed);
    const tooDeep = lay(base({ copy: text, bounding_box: target, obstacles: around(20) }));
    expect(tooDeep.paddingX).toBeUndefined();
    expect(tooDeep.obstacleOverlap).toBeGreaterThan(0);
  });

  it("leaves the padding alone when nothing overlaps", () => {
    const l = lay(base({ bounding_box: { x: 100, y: 300, width: 50, height: 30 } }));
    expect(l.paddingX).toBeUndefined();
  });
});
