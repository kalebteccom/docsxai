// The box maths of scripts/layout-audit.mjs. The browser part runs by hand on a machine with
// Chromium; these checks need none.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WIDTHS,
  allViewports,
  centring,
  findingsFor,
  formatTable,
  horizontalSpill,
  pageOverflows,
  readConfig,
  viewportsFor,
} from "./layout-audit.mjs";

test("eight widths, each portrait and landscape at the same width", () => {
  assert.deepEqual(WIDTHS, [320, 360, 390, 430, 768, 1024, 1280, 1920]);
  const all = allViewports();
  assert.equal(all.length, 16);
  for (const w of WIDTHS) {
    const [p, l] = viewportsFor(w);
    assert.equal(p.width, w);
    assert.equal(l.width, w);
    assert.ok(p.height > w, `${w} portrait is taller than wide`);
    assert.ok(l.height < w, `${w} landscape is wider than tall`);
  }
});

test("page overflow is scrollWidth beyond clientWidth", () => {
  assert.equal(pageOverflows(390, 390), false);
  assert.equal(pageOverflows(391, 390), true);
  assert.equal(pageOverflows(391, 390, 1), false);
});

test("spill measures the larger of the left and right overrun", () => {
  assert.equal(horizontalSpill({ x: 0, width: 390 }, 390), null);
  assert.equal(horizontalSpill({ x: 10, width: 400 }, 390), 20);
  assert.equal(horizontalSpill({ x: -12.34, width: 100 }, 390), 12.3);
  assert.equal(horizontalSpill({ x: 0.3, width: 390 }, 390), null, "within half a pixel");
  assert.equal(horizontalSpill({ x: 500, width: 0 }, 390), null, "a zero-width box never counts");
});

test("centring compares centres and the left and right insets", () => {
  const parent = { x: 0, y: 0, width: 44, height: 44 };
  assert.deepEqual(centring(parent, { x: 12, y: 12, width: 20, height: 20 }), {
    dx: 0,
    dy: 0,
    insetDelta: 0,
    ok: true,
  });
  const right = centring(parent, { x: 14, y: 12, width: 20, height: 20 });
  assert.equal(right.dx, 2);
  assert.equal(right.insetDelta, 4);
  assert.equal(right.ok, false);
  const low = centring(parent, { x: 12, y: 13.5, width: 20, height: 20 });
  assert.equal(low.dy, 1.5);
  assert.equal(low.ok, false);
  assert.equal(centring(parent, { x: 12.5, y: 12, width: 20, height: 20 }).ok, true, "1 px slack");
});

test("findings name the page, viewport, kind and element", () => {
  const vp = { width: 320, height: 569, orientation: "portrait" };
  const rows = findingsFor("/", vp, {
    scrollWidth: 346,
    clientWidth: 320,
    elements: [
      { name: "div.docsx-snap", box: { x: 16, y: 0, width: 330, height: 10 } },
      { name: "p", box: { x: 16, y: 0, width: 288, height: 10 } },
    ],
    pairs: [
      {
        name: "button.docsx-copy",
        parent: { x: 0, y: 0, width: 44, height: 44 },
        child: { x: 14, y: 12, width: 20, height: 20 },
      },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.viewport, r.kind, r.element]),
    [
      ["320x569 portrait", "page-overflow", "document"],
      ["320x569 portrait", "spill", "div.docsx-snap"],
      ["320x569 portrait", "off-centre", "button.docsx-copy"],
    ],
  );
  assert.equal(rows[1].detail, "26px past the edge");
});

test("the table pads every column to its widest cell", () => {
  const out = formatTable([
    {
      page: "/",
      viewport: "320x569 portrait",
      kind: "spill",
      element: "pre",
      detail: "4px past the edge",
    },
  ]);
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("page  viewport"));
  assert.ok(lines[2].includes("4px past the edge"));
});

test("the config keeps well-formed entries only", () => {
  assert.deepEqual(readConfig(undefined), { paths: [], center: [], ignore: [] });
  assert.deepEqual(
    readConfig({
      paths: ["/", 3],
      center: [{ parent: ".a", child: ".b" }, { parent: ".a" }],
      ignore: [".skip"],
    }),
    { paths: ["/"], center: [{ parent: ".a", child: ".b" }], ignore: [".skip"] },
  );
});
