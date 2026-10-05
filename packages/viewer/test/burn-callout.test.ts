import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_WIDTH_RATIO,
  CALLOUT_WIDTH_FLOOR,
  MAX_CALLOUT_WIDTH,
  layoutBoxes,
  layoutCallout,
  measureCallout,
  widthLadder,
} from "../src/burn-callout.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { overlapArea } from "../src/obstacle-placement.js";
import type { Rect } from "../src/placement.js";
import type { AnnotationRecord } from "../src/annotations.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const COPY =
  "Tasks an agent is working on right now sit in In progress, so you can see what moves.";

function ann(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    step: "board",
    selector: "#x",
    copy: COPY,
    bounding_box: { x: 330, y: 300, width: 30, height: 24 },
    ...overrides,
  };
}
const layout = (a: AnnotationRecord, image = { width: 390, height: 844 }, clear: Rect[] = []) =>
  layoutCallout({ ann: a, target: a.bounding_box!, image, metrics: METRICS, clear });
const calloutBox = (l: ReturnType<typeof layout>) => layoutBoxes(l)[0]!;

describe("widthLadder", () => {
  it("is the long-standing 280 without obstacles or max_width, whatever the image width", () => {
    expect(widthLadder(390, false)).toEqual([280]);
    expect(widthLadder(100, false)).toEqual([280]);
    expect(widthLadder(1280, false, {})).toEqual([280]);
    expect(widthLadder(390, false, { inside: true, side: "top" })).toEqual([280]);
  });

  it("with obstacles is min(280, 0.62 x width), floored, with two narrower fallbacks", () => {
    expect(ADAPTIVE_WIDTH_RATIO).toBe(0.62);
    expect(widthLadder(390, true)).toEqual([242, 205, CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(320, true)).toEqual([198, CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(100, true)).toEqual([CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(260, true)).toEqual([CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(400, true)).toEqual([248, 208, CALLOUT_WIDTH_FLOOR]);
  });

  it("stays at 280 with obstacles once the image is wide enough", () => {
    expect(widthLadder(452, true)).toEqual([MAX_CALLOUT_WIDTH]);
    expect(widthLadder(800, true)).toEqual([MAX_CALLOUT_WIDTH]);
    expect(widthLadder(1280, true)).toEqual([MAX_CALLOUT_WIDTH]);
  });

  it("takes an explicit max_width over the adaptive one, clamped to 120..560", () => {
    expect(widthLadder(800, false, { max_width: 360 })).toEqual([360, 264, CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(390, true, { max_width: 200 })).toEqual([200, 184, CALLOUT_WIDTH_FLOOR]);
    expect(widthLadder(390, true, { max_width: 100 })).toEqual([120]);
    expect(widthLadder(390, true, { max_width: 900 })[0]).toBe(560);
    expect(widthLadder(390, true, { max_width: Number.NaN })).toEqual([242, 205, 168]);
  });
});

describe("measureCallout", () => {
  it("wraps to the given width and defaults to 280", () => {
    const wide = measureCallout(COPY, METRICS);
    expect(wide.size.width).toBeLessThanOrEqual(MAX_CALLOUT_WIDTH);
    expect(measureCallout(COPY, METRICS, 280)).toEqual(wide);
    const narrow = measureCallout(COPY, METRICS, 180);
    expect(narrow.size.width).toBeLessThanOrEqual(180);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.lines.join(" ")).toBe(wide.lines.join(" "));
  });
});

describe("layoutCallout adaptive width", () => {
  // Free strip x 180..390 between a text column and the screen edge, bands above and below it.
  const column = Array.from({ length: 13 }, (_, i) => ({
    x: 16,
    y: 200 + 30 * i,
    width: 164,
    height: 22,
  }));
  const obstacles = [
    { x: 0, y: 0, width: 390, height: 190 },
    ...column,
    { x: 0, y: 612, width: 390, height: 232 },
  ];

  it("shrinks a callout that has no clear spot at full width until it fits", () => {
    const full = layout(ann({ obstacles: [] }));
    expect(calloutBox(full).width).toBeGreaterThan(242);
    const l = layout(ann({ obstacles }));
    const box = calloutBox(l);
    expect(box.width).toBeLessThanOrEqual(210);
    expect(l.obstacleOverlap).toBe(0);
    expect(l.otherOverlap).toBe(0);
    for (const o of obstacles) expect(overlapArea(box, o)).toBe(0);
  });

  it("keeps the widest box that is clear", () => {
    const l = layout(ann({ obstacles: [{ x: 0, y: 0, width: 5, height: 5 }] }));
    const widest = measureCallout("" + COPY, METRICS, 242).size.width;
    expect(calloutBox(l).width).toBe(widest);
  });

  it("still lays the callout out when nothing is clear, and reports what it covers", () => {
    const wall = [{ x: 0, y: 0, width: 390, height: 844 }];
    const l = layout(ann({ obstacles: wall }));
    expect(l.obstacleOverlap).toBeGreaterThan(0);
    const box = calloutBox(l);
    expect(box.width).toBeLessThanOrEqual(242);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });

  it("leaves a wide screenshot at 280", () => {
    const wide = layout(ann({ obstacles }), { width: 800, height: 844 });
    expect(calloutBox(wide).width).toBeLessThanOrEqual(280);
    expect(calloutBox(wide).width).toBeGreaterThan(242);
  });
});

describe("layoutCallout placement", () => {
  it("honours max_width without obstacles", () => {
    const l = layout(ann({ placement: { max_width: 180 } }), { width: 800, height: 600 });
    expect(calloutBox(l).width).toBeLessThanOrEqual(180);
  });

  it("puts the callout inside a target that can hold it, with no arrow or stem", () => {
    const panel = { x: 32, y: 500, width: 326, height: 317 };
    const l = layout(ann({ bounding_box: panel, placement: { inside: true } }));
    const box = calloutBox(l);
    expect(l.mode).toBe("inside");
    expect(l.side).toBeNull();
    expect(l.arrow).toBeNull();
    expect(l.stem).toBeNull();
    expect(layoutBoxes(l)).toHaveLength(1);
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.y).toBeGreaterThanOrEqual(panel.y);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(box.y + box.height).toBeLessThanOrEqual(panel.y + panel.height);
  });

  it("narrows the callout to fit a target narrower than the full width", () => {
    const target = { x: 20, y: 400, width: 200, height: 200 };
    const l = layout(ann({ bounding_box: target, placement: { inside: true } }));
    expect(l.mode).toBe("inside");
    expect(calloutBox(l).width).toBeLessThanOrEqual(target.width - 16);
  });

  it("falls back to the outside placement when the target is too small to hold the callout", () => {
    const small = layout(ann({ placement: { inside: true } }));
    expect(small.mode).toBe("outside");
    expect(small.arrow).not.toBeNull();
    const thin = layout(
      ann({ bounding_box: { x: 20, y: 400, width: 300, height: 40 }, placement: { inside: true } }),
    );
    expect(thin.mode).toBe("outside");
  });

  it("keeps an inside callout off the obstacles inside the target and off another halo", () => {
    const panel = { x: 32, y: 500, width: 326, height: 317 };
    const text = { x: 40, y: 508, width: 310, height: 100 };
    const l = layout(
      ann({ bounding_box: panel, placement: { inside: true }, obstacles: [text] }),
      undefined,
      [],
    );
    expect(l.obstacleOverlap).toBe(0);
    expect(overlapArea(calloutBox(l), text)).toBe(0);
  });

  it("only tries the pinned side, and aligns along it", () => {
    const target = { x: 100, y: 400, width: 160, height: 30 };
    const image = { width: 800, height: 800 };
    const l = layout(
      ann({ bounding_box: target, placement: { side: "bottom", align: "start" } }),
      image,
    );
    expect(l.side).toBe("bottom");
    expect(calloutBox(l).x).toBe(target.x);
    const blocked = layout(
      ann({
        bounding_box: target,
        placement: { side: "bottom" },
        obstacles: [{ x: 60, y: 436, width: 300, height: 120 }],
      }),
      image,
    );
    expect(blocked.side).toBe("bottom");
  });

  it("moves only the callout under nudge when pin_arrow is set", () => {
    const target = { x: 300, y: 400, width: 100, height: 30 };
    const image = { width: 800, height: 800 };
    const at = (a: Partial<AnnotationRecord>) =>
      layout(
        ann({ bounding_box: target, placement: { side: "top", pin_arrow: true }, ...a }),
        image,
      );
    const still = at({});
    const moved = at({ nudge: { x: 30, y: -40 } });
    expect(moved.arrow).toEqual({ x: expect.any(Number), y: target.y });
    expect(moved.arrow!.y).toBe(still.arrow!.y);
    expect(calloutBox(moved).y).toBe(calloutBox(still).y - 40);
    expect(moved.stem).not.toBeNull();
    // the nudge is already in the layout; the renderer adds nothing
    expect(moved.nudge).toEqual({ x: 0, y: 0 });
    // without pin_arrow the arrow moves with the callout
    const together = layout(ann({ bounding_box: target, nudge: { x: 30, y: -40 } }), image);
    expect(together.nudge).toEqual({ x: 30, y: -40 });
  });

  it("is deterministic", () => {
    const a = () =>
      ann({
        obstacles: [{ x: 16, y: 280, width: 200, height: 20 }],
        placement: { max_width: 220, side: "left", align: "end" },
      });
    expect(layout(a())).toEqual(layout(a()));
  });
});
