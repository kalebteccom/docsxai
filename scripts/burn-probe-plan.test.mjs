import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySides,
  askedSide,
  formatProbe,
  obstacleHits,
  parseSideOverride,
  toRecords,
} from "./burn-probe-plan.mjs";

const sidecar = {
  width: 390,
  height: 780,
  annotations: [
    {
      index: 1,
      copy: "Lo que va a ejecutar",
      bbox: { x: 23, y: 294.8, width: 344, height: 34.5, extra: 1 },
      obstacles: [{ x: 23, y: 340, width: 140, height: 20 }],
    },
    { index: 2, copy: "Recházalo", bbox: { x: 23, y: 568.86, width: 168, height: 44 } },
  ],
};

test("a capture sidecar becomes numbered burner records", () => {
  const records = toRecords(sidecar, { step: "approval-gate" });
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    step: "approval-gate",
    selector: "annotation-1",
    copy: "Lo que va a ejecutar",
    bounding_box: { x: 23, y: 294.8, width: 344, height: 34.5 },
    index: 1,
    obstacles: [{ x: 23, y: 340, width: 140, height: 20 }],
  });
});

test("a single sidecar annotation carries no index", () => {
  const one = toRecords({ annotations: [sidecar.annotations[1]] });
  assert.equal(one[0].index, undefined);
});

test("an annotations@1 file is filtered by step", () => {
  const file = {
    annotations: [
      { step: "a", selector: "#x", bounding_box: { x: 0, y: 0, width: 1, height: 1 } },
      { step: "b", selector: "#y", bounding_box: { x: 0, y: 0, width: 1, height: 1 } },
    ],
  };
  assert.deepEqual(
    toRecords(file, { step: "b" }).map((r) => r.selector),
    ["#y"],
  );
  assert.throws(() => toRecords(file, { step: "c" }), /none for step "c"/);
  assert.throws(() => toRecords({}), /annotations array/);
});

test("side overrides set the hint or the strict side", () => {
  assert.deepEqual(parseSideOverride("2=bottom"), { position: 2, side: "bottom", strict: false });
  assert.throws(() => parseSideOverride("2=up"), /position>=/);
  const records = toRecords(sidecar);
  const soft = applySides(records, [parseSideOverride("1=bottom")]);
  assert.equal(soft[0].arrow_style, "bottom");
  assert.deepEqual(askedSide(soft[0]), { side: "bottom", how: "arrow_style" });
  const strict = applySides(soft, [parseSideOverride("1=top", true)]);
  assert.deepEqual(askedSide(strict[0]), { side: "top", how: "placement.side" });
  const back = applySides(strict, [parseSideOverride("1=left")]);
  assert.deepEqual(askedSide(back[0]), { side: "left", how: "arrow_style" });
  assert.equal(records[0].arrow_style, undefined, "the input records are left alone");
  assert.throws(() => applySides(records, [parseSideOverride("5=top")]), /there are 2/);
});

test("obstacle hits name the part, its area or the stem's run", () => {
  const hits = obstacleHits(
    {
      callout: { x: 0, y: 0, width: 50, height: 20 },
      stem: { x: 60, y: 0, width: 2, height: 100 },
      arrow: null,
    },
    [
      { x: 40, y: 10, width: 30, height: 30 },
      { x: 200, y: 200, width: 5, height: 5 },
    ],
  );
  assert.deepEqual(hits, [
    { obstacle: 1, part: "callout", area: 100 },
    { obstacle: 1, part: "stem", px: 30 },
  ]);
});

test("the report shows the asked side, the side taken and every side's score", () => {
  const text = formatProbe({
    image: { width: 390, height: 780 },
    theme: "none",
    scale: 1,
    annotations: [
      {
        position: 1,
        copy: "Tema",
        asked: { side: "top", how: "arrow_style" },
        mode: "outside",
        side: "left",
        callout: { x: 215.47, y: 141.5, width: 62, height: 37 },
        badge: null,
        lines: ["Tema"],
        stem: 0,
        connector: "outline",
        obstacleOverlap: 0,
        otherOverlap: 0,
        ratio: 0,
        unplaceable: false,
        hits: [],
        verdicts: [
          { side: "top", rank: 0, cost: 2653, overlap: 369, stem: 0 },
          { side: "right", rank: 2, cost: null, overlap: 0, stem: 0 },
          { side: "left", rank: 3, cost: 132, overlap: 0, stem: 0 },
        ],
      },
    ],
  });
  assert.match(text, /asked top \(arrow_style\) -> side left, hint lost/);
  assert.match(text, /top cost 2653 overlap 369 stem 0 \| right no room \| left\* cost 132/);
  assert.match(text, /connector outline/);
});
