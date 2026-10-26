import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  BADGE_REACH,
  PROJECTS,
  defaultTokensName,
  detectLayout,
  formatReport,
  frameRows,
  gap,
  listFrames,
  previewName,
  probeRatio,
  readSidecar,
  selectFrames,
  summarize,
} from "./burn-probe-batch-plan.mjs";

const FIXTURES = new URL("./fixtures-probe/", import.meta.url);
const tree = async (name) =>
  (await readdir(new URL(`${name}/`, FIXTURES), { recursive: true })).map((f) =>
    f.split("\\").join("/"),
  );

test("a flat tree gives its frames and ignores the rest", async () => {
  const frames = listFrames(await tree("flat"));
  assert.deepEqual(
    frames.map((f) => f.label),
    ["board.en.dark.1280", "board.es.light.390"],
  );
  assert.equal(detectLayout(frames), "flat");
  assert.deepEqual(frames[0], {
    layout: "flat",
    label: "board.en.dark.1280",
    screen: "board",
    locale: "en",
    theme: "dark",
    width: 1280,
    png: "board.en.dark.1280.png",
    json: "board.en.dark.1280.json",
  });
});

test("a rawcap tree gives flow, step, locale, theme and width", async () => {
  const frames = listFrames(await tree("rawcap"));
  assert.equal(detectLayout(frames), "rawcap");
  assert.deepEqual(
    frames.map((f) => f.label),
    [
      "checkout/pay/en.dark.1280",
      "checkout/pay/en.dark.390",
      "checkout/pay/en.light.390",
      "checkout/pay/es.dark.390",
      "checkout/review/en.dark.390",
    ],
  );
  const wide = frames[0];
  assert.equal(wide.screen, "checkout/pay");
  assert.equal(wide.width, 1280);
  assert.equal(wide.json, "checkout/pay/en.dark.1280.json");
  // A viewport name keeps the width it ends in, and the label keeps the name it was written with.
  const named = listFrames(["checkout/review/en.dark.mobile-390.png"]);
  assert.equal(named[0].width, 390);
  assert.equal(named[0].label, "checkout/review/en.dark.390");
});

test("a tree with both kinds of frame is mixed, an empty one is none", () => {
  const frames = listFrames(["a.en.dark.390.png", "f/s/en.dark.390.png", "README.md", "x/y.png"]);
  assert.equal(detectLayout(frames), "mixed");
  assert.equal(detectLayout([]), "none");
  assert.deepEqual(
    listFrames(["x/en.dark.390.png", "a/b/c/en.dark.390.png", "a/b/en.dim.390.png"]),
    [],
  );
});

test("frames are selected by theme, locale and width", async () => {
  const frames = listFrames(await tree("rawcap"));
  const pick = (o) => selectFrames(frames, o).map((f) => f.label);
  assert.deepEqual(pick({ theme: "dark", locale: "en", widths: [390] }), [
    "checkout/pay/en.dark.390",
    "checkout/review/en.dark.390",
  ]);
  assert.deepEqual(pick({ theme: "dark", locale: "es", widths: [1280, 390] }), [
    "checkout/pay/es.dark.390",
  ]);
  assert.deepEqual(pick({ theme: "light", locale: "en", widths: [1280] }), []);
});

test("preview names flatten the rawcap path", () => {
  const [flat] = listFrames(["board.en.dark.1280.png"]);
  const [cap] = listFrames(["checkout/pay/en.dark.390.png"]);
  assert.equal(previewName(flat), "board.en.dark.1280.png");
  assert.equal(previewName(cap), "checkout__pay__en.dark.390.png");
});

test("a rawcap sidecar reads into burner records and lists the unboxed annotation", async () => {
  const [, frame] = listFrames(await tree("rawcap"));
  const doc = JSON.parse(await readFile(new URL(`rawcap/${frame.json}`, FIXTURES), "utf8"));
  const { records, skipped } = readSidecar(doc, frame.json, frame);
  assert.deepEqual(skipped, [2]);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    step: "checkout/pay",
    selector: "annotation-1",
    copy: "Pick a card",
    bounding_box: { x: 2, y: 2, width: 4, height: 2 },
    index: 1,
    arrow_style: "top",
    obstacles: [{ x: 0, y: 0, width: 2, height: 2 }],
  });
  assert.equal(records[1].bounding_box, undefined);
});

test("a flat sidecar goes through the strict sidecar check", async () => {
  const [frame] = listFrames(await tree("flat"));
  const doc = JSON.parse(await readFile(new URL(`flat/${frame.json}`, FIXTURES), "utf8"));
  const { records, skipped } = readSidecar(doc, frame.json, frame);
  assert.deepEqual(skipped, [2]);
  assert.equal(records[0].step, "board");
  assert.throws(
    () => readSidecar({ ...doc, schema: "other@1" }, "f.json", frame),
    /f\.json: schema/,
  );
  assert.throws(
    () => readSidecar({ ...doc, viewport: { width: 390, height: 8 } }, "f.json", frame),
    /viewport\.width 390 does not match/,
  );
});

test("a rawcap sidecar with a wrong width, copy or box is refused with its file", () => {
  const frame = { screen: "f/s", width: 390 };
  const ok = {
    width: 390,
    height: 8,
    annotations: [{ index: 1, copy: "A", bbox: { x: 1, y: 1, width: 2, height: 2 } }],
  };
  assert.equal(readSidecar(ok, "f.json", frame).records.length, 1);
  assert.throws(() => readSidecar({ ...ok, width: 1280 }, "f.json", frame), /f\.json: width 1280/);
  assert.throws(
    () => readSidecar({ ...ok, annotations: [{ copy: "" }] }, "f.json", frame),
    /annotation 1: copy/,
  );
  assert.throws(
    () => readSidecar({ ...ok, annotations: [{ copy: "A", bbox: { x: 1 } }] }, "f.json", frame),
    /annotation 1: bbox needs/,
  );
  assert.throws(() => readSidecar([], "f.json", frame), /not a JSON object/);
  assert.deepEqual(readSidecar({ width: 390, annotations: [] }, "f.json", frame).records, []);
});

test("the gap between boxes is 0 when they touch or overlap", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(gap(a, { x: 10, y: 0, width: 5, height: 5 }), 0);
  assert.equal(gap(a, { x: 5, y: 5, width: 5, height: 5 }), 0);
  assert.equal(gap(a, { x: 13, y: 14, width: 5, height: 5 }), 5);
});

const frame = { label: "board.en.dark.390" };
const target = { x: 100, y: 200, width: 80, height: 30 };
const text = { x: 100, y: 150, width: 80, height: 20 };
const record = (n, extra = {}) => ({
  step: "board",
  selector: "a",
  copy: "Copy",
  index: n,
  bounding_box: target,
  ...extra,
});
const reported = (extra = {}) => ({
  step: "board",
  index: 1,
  selector: "a",
  mode: "outside",
  side: "top",
  callout: { x: 100, y: 160, width: 80, height: 30 },
  badge: { x: 183, y: 190, width: 20, height: 20 },
  obstacle_overlap: 0,
  other_overlap: 0,
  overlap_ratio: 0,
  unplaceable: false,
  ...extra,
});
const size = { width: 390, height: 844 };

test("a clean caption is OK", () => {
  const [row] = frameRows(
    frame,
    [record(1)],
    [reported({ callout: { x: 100, y: 100, width: 80, height: 30 } })],
    [{ length: 40, crossing: 0 }],
    size,
  );
  assert.deepEqual(row, {
    frame: "board.en.dark.390",
    n: 1,
    mode: "full",
    side: "top",
    connector: "40",
    text: 0,
    chrome: 0,
    crosses: "no",
    badge: "yes",
    verdict: "OK",
    notes: "",
  });
});

test("a caption over listed text is CHECK with the px² it covers", () => {
  const [row] = frameRows(
    frame,
    [record(1, { obstacles: [text] })],
    [reported()],
    [{ length: 0, crossing: 0 }],
    size,
  );
  assert.equal(row.text, 800);
  assert.equal(row.verdict, "CHECK");
  assert.match(row.notes, /caption over text/);
});

test("a phone caption on the header or bottom nav is CHECK", () => {
  const onHeader = reported({ callout: { x: 10, y: 20, width: 80, height: 30 } });
  const [row] = frameRows(frame, [record(1)], [onHeader], [{ length: 0, crossing: 0 }], size);
  assert.equal(row.chrome, 80 * 30);
  assert.equal(row.verdict, "CHECK");
  const [desk] = frameRows(frame, [record(1)], [onHeader], [{ length: 0, crossing: 0 }], {
    width: 1280,
    height: 800,
  });
  assert.equal(desk.chrome, 0);
});

test("a connector crossing text is CHECK on a phone and only shown on a desktop", () => {
  const clear = reported({ callout: { x: 100, y: 100, width: 80, height: 30 } });
  const conn = [{ length: 60, crossing: 12 }];
  const [phone] = frameRows(frame, [record(1)], [clear], conn, size);
  assert.equal(phone.crosses, "yes");
  assert.equal(phone.verdict, "CHECK");
  const [desk] = frameRows(frame, [record(1)], [clear], conn, { width: 1280, height: 800 });
  assert.equal(desk.crosses, "yes");
  assert.equal(desk.verdict, "OK");
});

test("a badge off its target by more than the reach, or on it, is not adjacent", () => {
  const clear = { callout: { x: 100, y: 100, width: 80, height: 30 } };
  const far = { x: 100 + 80 + BADGE_REACH + 1, y: 200, width: 10, height: 10 };
  const on = { x: 110, y: 205, width: 10, height: 10 };
  const near = { x: 100 + 80 + BADGE_REACH, y: 200, width: 10, height: 10 };
  const verdict = (badge) =>
    frameRows(
      frame,
      [record(1)],
      [reported({ ...clear, badge })],
      [{ length: 0, crossing: 0 }],
      size,
    )[0];
  assert.equal(verdict(far).badge, "no");
  assert.equal(verdict(far).verdict, "CHECK");
  assert.equal(verdict(on).badge, "no");
  assert.equal(verdict(near).badge, "yes");
  assert.equal(verdict(null).badge, "-");
});

test("an unplaceable caption and a caption over another target are CHECK", () => {
  const records = [
    record(1),
    record(2, { bounding_box: { x: 100, y: 100, width: 80, height: 30 } }),
  ];
  const report = [
    reported({
      unplaceable: true,
      callout: { x: 100, y: 110, width: 80, height: 20 },
      badge: null,
    }),
    reported({ index: 2, callout: { x: 300, y: 300, width: 10, height: 10 }, badge: null }),
  ];
  const rows = frameRows(
    frame,
    records,
    report,
    [
      { length: 0, crossing: 0 },
      { length: 0, crossing: 0 },
    ],
    size,
  );
  assert.equal(rows[0].verdict, "CHECK");
  assert.match(rows[0].notes, /unplaceable/);
  assert.match(rows[0].notes, /covers the target of caption 2/);
  assert.equal(rows[1].verdict, "OK");
});

test("a badge-only annotation and a skipped one get their own mode", () => {
  const records = [record(1), { ...record(2), bounding_box: undefined }];
  const report = [
    reported({ mode: "none", side: null, callout: null, caption_style: "badge" }),
    {
      ...reported({ index: 2, mode: "none", side: null, callout: null, badge: null }),
      skipped: "no bounding_box",
    },
  ];
  const rows = frameRows(frame, records, report, [], size);
  assert.deepEqual(
    [rows[0].mode, rows[0].side, rows[0].connector, rows[0].verdict],
    ["badge", "-", "-", "OK"],
  );
  assert.deepEqual(
    [rows[1].mode, rows[1].verdict, rows[1].notes],
    ["skipped", "SKIPPED", "no bounding_box"],
  );
});

test("the summary counts frames, annotations and each verdict", () => {
  const rows = [{ verdict: "OK" }, { verdict: "OK" }, { verdict: "CHECK" }, { verdict: "SKIPPED" }];
  assert.deepEqual(summarize(3, rows, 1), {
    frames: 3,
    annotations: 4,
    ok: 2,
    check: 1,
    skipped: 1,
    failed: 1,
  });
});

test("the report lists CHECK rows before the full table and escapes pipes", () => {
  const row = (n, verdict, notes = "") => ({
    frame: "a|b.en.dark.390",
    n,
    mode: "full",
    side: "top",
    connector: "0",
    text: 0,
    chrome: 0,
    crosses: "no",
    badge: "yes",
    verdict,
    notes,
  });
  const md = formatReport({
    meta: { layout: "flat", theme: "dark", locale: "en", widths: [1280, 390], tokens: "t.json" },
    rows: [row(1, "OK"), row(2, "CHECK", "caption over text")],
    frames: 1,
    errors: [{ frame: "x.en.dark.390", message: "x.json: missing" }],
  });
  assert.match(md, /Layout flat, theme dark, locale en, widths 1280, 390, tokens t\.json\./);
  assert.match(md, /\| 1 \| 2 \| 1 \| 1 \| 0 \| 1 \|/);
  assert.ok(md.indexOf("## CHECK") < md.indexOf("## All annotations"));
  assert.ok(md.indexOf("caption over text") < md.indexOf("## All annotations"));
  assert.match(md, /a\\\|b\.en\.dark\.390/);
  assert.match(md, /## Frames that failed\n\n- x\.en\.dark\.390: x\.json: missing/);
  const clean = formatReport({
    meta: { layout: "rawcap", theme: "dark", locale: "en", widths: [390], tokens: "t.json" },
    rows: [row(1, "OK")],
    frames: 1,
  });
  assert.match(clean, /## CHECK\n\nNone\./);
  assert.doesNotMatch(clean, /Frames that failed/);
  assert.doesNotMatch(clean, /earlier|old name/);
  const legacy = formatReport({
    meta: { layout: "flat", theme: "dark", locale: "en", widths: [390], tokens: "t.json" },
    rows: [row(1, "OK")],
    frames: 1,
    legacy: 2,
  });
  assert.equal(legacy.split("old name still works").length - 1, 1);
});

test("--project picks the default tokens file and both projects ship one per theme", async () => {
  assert.equal(defaultTokensName("trackxai", "dark"), "trackxai-dark.tokens.json");
  assert.equal(defaultTokensName("remotxai", "light"), "remotxai-light.tokens.json");
  assert.throws(
    () => defaultTokensName("other", "dark"),
    /--project must be one of trackxai, remotxai/,
  );
  const files = await readdir(new URL("../examples/burn-theme/", import.meta.url));
  for (const project of PROJECTS)
    for (const theme of ["dark", "light"])
      assert.ok(files.includes(defaultTokensName(project, theme)));
});

test("probeRatio takes the sidecar's device_scale_factor, else an exact 2 to 4 multiple of the width", () => {
  const frame = { width: 390, label: "x.en.dark.390" };
  assert.equal(probeRatio({ device_scale_factor: 2 }, frame, 780), 2);
  assert.equal(probeRatio({}, frame, 780), 2);
  assert.equal(probeRatio({}, frame, 1170), 3);
  assert.equal(probeRatio({}, frame, 390), 1);
  assert.equal(probeRatio({}, frame, 400), 1, "a PNG that is no whole multiple burns at 1");
  assert.equal(probeRatio({}, frame, 1950), 1, "five times is past the 1 to 4 range");
  assert.equal(probeRatio(null, frame, 780), 2);
  for (const bad of [0, 5, "2", NaN, null]) {
    assert.throws(
      () => probeRatio({ device_scale_factor: bad }, frame, 780),
      /x\.en\.dark\.390: device_scale_factor must be a number from 1 to 4/,
    );
  }
});
