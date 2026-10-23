// node --test scripts/visual-plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHOTS,
  VIEWPORTS,
  candidateFiles,
  contentType,
  pickTable,
  planCaptures,
  summaryMarkdown,
  tableScrollY,
} from "./visual-plan.mjs";

test("every shot runs at both widths and schemes, mobile-only shots at 390 px only", () => {
  const plan = planCaptures();
  const perShot = (s) => (s.mobileOnly ? 2 : 4) * (s.bottom ? 2 : 1);
  assert.equal(
    plan.length,
    SHOTS.reduce((n, s) => n + perShot(s), 0),
  );
  assert.ok(plan.filter((p) => p.mobileOnly).every((p) => p.viewport.width === 390));
});

test("the plan has 42 docs and 24 viewer captures", () => {
  const plan = planCaptures();
  assert.equal(plan.filter((p) => p.surface === "docs").length, 42);
  assert.equal(plan.filter((p) => p.surface === "viewer").length, 24);
});

test("file names are unique, kebab-case and carry width and scheme", () => {
  const files = planCaptures().map((p) => p.file);
  assert.equal(new Set(files).size, files.length);
  for (const f of files)
    assert.match(f, /^(docs|viewer)\/[a-z0-9-]+--(390|1280)--(light|dark)\.png$/);
});

test("no capture is a whole page: top captures carry a clip at the width's max height", () => {
  const plan = planCaptures();
  assert.ok(plan.every((p) => !("fullPage" in p)));
  const top = plan.filter((p) => p.capture === "top");
  assert.ok(top.length > 0);
  for (const p of top)
    assert.deepEqual(p.clip, { x: 0, y: 0, width: p.viewport.width, height: p.viewport.maxHeight });
  assert.ok(plan.filter((p) => p.capture !== "top").every((p) => p.clip === undefined));
  const max = Object.fromEntries(VIEWPORTS.map((v) => [v.width, v.maxHeight]));
  assert.deepEqual(max, { 390: 2400, 1280: 1600 });
});

test("the wide-table capture shows the table region, not the top of the page", () => {
  const wide = planCaptures().filter((p) => p.state === "wide-table");
  assert.equal(wide.length, 4);
  assert.ok(wide.every((p) => p.capture === "table" && p.clip === undefined));
});

test("long pages get a --bottom sibling at every width and scheme", () => {
  const plan = planCaptures();
  const bottoms = plan.filter((p) => p.capture === "bottom");
  assert.deepEqual(
    [...new Set(bottoms.map((p) => `${p.surface}/${p.state}`))],
    ["docs/home--bottom", "docs/wide-table--bottom", "viewer/flow--bottom"],
  );
  assert.equal(bottoms.length, 12);
  assert.ok(bottoms.every((p) => p.file.includes("--bottom--") && !("bottom" in p)));
  assert.ok(plan.some((p) => p.file === "docs/home--bottom--390--dark.png"));
});

test("a shot without capture is a viewport capture", () => {
  const [p] = planCaptures([{ surface: "docs", state: "x", path: "/" }], [VIEWPORTS[0]], ["light"]);
  assert.equal(p.capture, "viewport");
  assert.equal(p.file, "docs/x--390--light.png");
});

test("pickTable takes the first overflowing scroller, else the first table", () => {
  const fits = { scrollWidth: 600, clientWidth: 600 };
  const wide = { scrollWidth: 900, clientWidth: 600 };
  assert.deepEqual(pickTable([fits, wide, wide]), { index: 1, overflows: true });
  assert.deepEqual(pickTable([fits, { scrollWidth: 601, clientWidth: 600 }]), {
    index: 0,
    overflows: false,
  });
  assert.deepEqual(pickTable([]), { index: -1, overflows: false });
});

test("tableScrollY centres a short table under the header and bottom-aligns a tall one", () => {
  // 300 px table, 1000 px down the page, 800 px viewport, 64 px header:
  // room 736, centred means 218 px above the table under the header.
  assert.equal(
    tableScrollY({ top: 1000, bottom: 1300, scrollY: 0, viewportHeight: 800, headerHeight: 64 }),
    1000 - 64 - 218,
  );
  // 2000 px table: its bottom edge, plus 16 px, meets the viewport bottom.
  assert.equal(
    tableScrollY({ top: 500, bottom: 2500, scrollY: 100, viewportHeight: 844, headerHeight: 56 }),
    100 + 2500 + 16 - 844,
  );
  // Never above the top of the page.
  assert.equal(tableScrollY({ top: 80, bottom: 200, scrollY: 0, viewportHeight: 800 }), 0);
});

test("the plan covers the states the workflow promises", () => {
  const states = new Set(SHOTS.map((s) => `${s.surface}/${s.state}`));
  for (const s of [
    "docs/404",
    "docs/search-open",
    "docs/search-no-results",
    "docs/skip-link-followed",
    "docs/wide-table",
    "viewer/empty",
    "viewer/error",
    "viewer/focused-step",
  ])
    assert.ok(states.has(s), s);
});

test("candidateFiles maps directories to index.html and refuses to leave the root", () => {
  assert.deepEqual(candidateFiles("/"), ["index.html"]);
  assert.deepEqual(candidateFiles("/reference/flow-file/?q=1"), ["reference/flow-file/index.html"]);
  assert.deepEqual(candidateFiles("/a/b.png"), ["a/b.png", "a/b.png/index.html", "a/b.png.html"]);
  assert.equal(candidateFiles("/../etc/passwd"), null);
  assert.equal(candidateFiles("/a/%2e%2e/%2e%2e/x"), null);
  assert.equal(candidateFiles("/a%5c..%5cx"), null);
  assert.equal(candidateFiles("/%E0%A4%A"), null);
  assert.equal(candidateFiles("relative"), null);
});

test("contentType knows the site's asset types", () => {
  assert.equal(contentType("x/index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a.WOFF2"), "font/woff2");
  assert.equal(contentType("pagefind/wasm.en.pagefind"), "application/octet-stream");
});

test("summaryMarkdown lists files by surface and failures first", () => {
  const md = summaryMarkdown(
    [
      { surface: "docs", file: "docs/home--390--light.png" },
      { surface: "viewer", file: "viewer/error--390--dark.png", error: "Timeout\nstack" },
    ],
    "visual-captures",
  );
  assert.match(md, /1 screenshots in the `visual-captures` artifact/);
  assert.match(md, /keep the top 2400 px at 390 wide and the top 1600 px at 1280 wide/);
  assert.doesNotMatch(md, /have a note/);
  assert.match(md, /1 captures failed:\n\n- `viewer\/error--390--dark.png`: Timeout\n/);
  assert.match(md, /<summary>docs \(1\)<\/summary>/);
  assert.doesNotMatch(md, /<summary>viewer/);
});

test("summaryMarkdown lists notes on captures that worked", () => {
  const md = summaryMarkdown(
    [{ surface: "docs", file: "docs/wide-table--1280--light.png", note: "no table overflows" }],
    "visual-captures",
  );
  assert.match(
    md,
    /1 captures have a note:\n\n- `docs\/wide-table--1280--light.png`: no table overflows\n/,
  );
});
