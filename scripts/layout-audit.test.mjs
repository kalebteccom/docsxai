// The box maths of scripts/layout-audit.mjs. The browser part runs by hand on a machine with
// Chromium; these checks need none.

import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WIDTHS,
  allViewports,
  centring,
  findingsFor,
  formatTable,
  horizontalSpill,
  isStep,
  pageOverflows,
  readConfig,
  readPageStates,
  stateFindingsFor,
  stateShifts,
  viewportsFor,
} from "./layout-audit.mjs";
import { readFileSync } from "node:fs";

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
  assert.deepEqual(readConfig(undefined), {
    paths: [],
    center: [],
    ignore: [],
    states: [],
    pageStates: [],
  });
  assert.deepEqual(
    readConfig({
      paths: ["/", 3],
      center: [{ parent: ".a", child: ".b" }, { parent: ".a" }],
      ignore: [".skip"],
    }),
    {
      paths: ["/"],
      center: [{ parent: ".a", child: ".b" }],
      ignore: [".skip"],
      states: [],
      pageStates: [],
    },
  );
});

const box = (y, height) => ({ x: 0, y, width: 100, height });

test("state shifts compare top and height with the first state, 1 px slack", () => {
  const rows = stateShifts([
    { state: "idle", box: box(100, 44) },
    { state: "pending", box: box(100.6, 44.9) },
    { state: "failed", box: box(100, 66) },
    { state: "done", box: box(98.5, 44) },
  ]);
  assert.deepEqual(rows, [
    { state: "pending", against: "idle", dTop: 0.6, dHeight: 0.9, ok: true },
    { state: "failed", against: "idle", dTop: 0, dHeight: 22, ok: false },
    { state: "done", against: "idle", dTop: -1.5, dHeight: 0, ok: false },
  ]);
  assert.equal(stateShifts([{ state: "idle", box: box(0, 1) }]).length, 0, "one state: nothing");
  assert.equal(stateShifts([])[0], undefined);
});

test("exactly 1 px is within tolerance, anything past it is not", () => {
  const [at] = stateShifts([
    { state: "idle", box: box(10, 20) },
    { state: "slow", box: box(11, 21) },
  ]);
  assert.equal(at.ok, true);
  const [past] = stateShifts([
    { state: "idle", box: box(10, 20) },
    { state: "slow", box: box(10, 21.2) },
  ]);
  assert.equal(past.ok, false);
});

test("width changes alone are not a state shift", () => {
  const [row] = stateShifts([
    { state: "idle", box: { x: 0, y: 0, width: 60, height: 44 } },
    { state: "done", box: { x: 0, y: 0, width: 80, height: 44 } },
  ]);
  assert.equal(row.ok, true);
});

test("state findings name the states and flag an element that vanished", () => {
  const vp = { width: 390, height: 693, orientation: "portrait" };
  const rows = stateFindingsFor(
    "/",
    vp,
    [
      {
        name: ".shot-figure[0]",
        boxes: [
          { state: "idle", box: box(200, 300) },
          { state: "failed", box: box(200, 340) },
        ],
      },
      {
        name: ".docsx-copy[0]",
        boxes: [
          { state: "idle", box: box(80, 44) },
          { state: "failed", box: box(80, 44) },
        ],
      },
      { name: ".shot-error[0]", boxes: [{ state: "failed", box: box(210, 40) }] },
    ],
    2,
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.element, r.detail]),
    [
      ["state-shift", ".shot-figure[0]", "failed vs idle: top 0 height 40"],
      ["state-missing", ".shot-error[0]", "not found in 1 state(s)"],
    ],
  );
  assert.equal(rows[0].viewport, "390x693 portrait");
});

test("state steps and entries are validated", () => {
  assert.equal(isStep({ set: ".a", attr: "data-state", value: "done" }), true);
  assert.equal(isStep({ set: ".a", attr: "data-state" }), false);
  assert.equal(isStep({ remove: ".a", attr: "hidden" }), true);
  assert.equal(isStep({ eval: "1" }), true);
  assert.equal(isStep({ click: "button" }), true);
  assert.equal(isStep({ wait: 100 }), true);
  assert.equal(isStep({ wait: -1 }), false);
  assert.equal(isStep(null), false);
  const cfg = readConfig({
    states: [
      {
        element: ".a",
        states: [{ name: "idle" }, { name: "done", steps: [{ wait: 1 }, { x: 1 }] }],
      },
      { element: ".b", states: [{ name: "idle" }] },
      { states: [{ name: "idle" }, { name: "done" }] },
    ],
  });
  assert.deepEqual(cfg.states, [
    {
      element: ".a",
      states: [
        { name: "idle", steps: [] },
        { name: "done", steps: [{ wait: 1 }] },
      ],
    },
  ]);
});

test("the shipped states config covers idle, pending, slow, failed and done", () => {
  const raw = JSON.parse(
    readFileSync(new URL("./layout-audit.states.json", import.meta.url), "utf8"),
  );
  const cfg = readConfig(raw);
  assert.equal(cfg.states.length, raw.states.length, "every entry is well formed");
  const names = new Set(cfg.states.flatMap((e) => e.states.map((s) => s.name)));
  for (const n of ["idle", "pending", "slow", "failed", "done"]) assert.ok(names.has(n), n);
  for (const e of cfg.states) assert.equal(e.states[0].name, "idle", "idle is the reference");
});

test("page states: a name is required, click and wait are selectors, scroll is bottom or nothing", () => {
  assert.deepEqual(
    readPageStates([
      { name: "lightbox", click: "a.docsx-zoom", wait: "dialog[open]" },
      { name: "lazy", scroll: "bottom" },
      { name: "odd", scroll: "top", click: 3, wait: "" },
      { click: ".x" },
      null,
    ]),
    [
      { name: "lightbox", click: "a.docsx-zoom", scroll: undefined, wait: "dialog[open]" },
      { name: "lazy", click: undefined, scroll: "bottom", wait: undefined },
      { name: "odd", click: undefined, scroll: undefined, wait: undefined },
    ],
  );
  assert.deepEqual(readPageStates("lightbox"), []);
});

test("the checked-in states file covers the lightbox and the lazy viewer flow", async () => {
  const raw = JSON.parse(
    await readFile(new URL("./layout-audit.states.json", import.meta.url), "utf8"),
  );
  const { pageStates: states } = readConfig(raw);
  const byName = Object.fromEntries(states.map((st) => [st.name, st]));
  assert.equal(byName.lightbox.click, "a.docsx-zoom");
  assert.equal(byName.lightbox.wait, "dialog.docsx-lightbox[open]");
  assert.equal(byName.lazy.scroll, "bottom");
});
