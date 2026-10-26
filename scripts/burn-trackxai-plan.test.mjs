import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calloutTexts,
  badgeOnly,
  badgeOnlyFrames,
  checkSidecar,
  isBadgeOnly,
  coverage,
  captureRatio,
  chromeBands,
  variantValue,
  contentHash,
  mergeManifest,
  parseRawName,
  parseRename,
  variantDir,
  WEBP_MAX_BYTES,
  cwebpArgs,
  webpTwinPath,
  webpVerdict,
} from "./burn-trackxai-plan.mjs";

test("raw names split into screen, locale, theme and width", () => {
  assert.deepEqual(parseRawName("ticket-panel.en.dark.1280.png"), {
    screen: "ticket-panel",
    locale: "en",
    theme: "dark",
    width: 1280,
  });
  assert.equal(parseRawName("ticket-panel.en.dark.1280.json"), null);
  assert.equal(parseRawName("board.en.dim.390.png"), null);
});

test("renames parse and refuse a malformed pair", () => {
  const map = parseRename("tokens=agent-tokens, ticket-panel=ticket");
  assert.equal(map.get("tokens"), "agent-tokens");
  assert.equal(map.get("ticket-panel"), "ticket");
  assert.equal(parseRename(undefined).size, 0);
  assert.throws(() => parseRename("tokens"), /--rename: "tokens"/);
  assert.throws(() => parseRename("a=B C"), /--rename/);
});

test("widths map to the pack directories", () => {
  assert.equal(variantDir(1280), "desktop-1280");
  assert.equal(variantDir(390), "mobile-390");
});

test("content hashes are 8 hex digits and stable", () => {
  assert.match(contentHash(Buffer.from("x")), /^[0-9a-f]{8}$/);
  assert.equal(contentHash(Buffer.from("x")), contentHash(Buffer.from("x")));
});

const box = { x: 1, y: 2, width: 3, height: 4 };
const sidecar = (annotations) => ({
  schema: "docsxai/raw-capture-sidecar@1",
  step: "board",
  viewport: { width: 1280, height: 800 },
  annotations,
});

test("a good sidecar gives records and lists annotations without a box", () => {
  const { records, skipped } = checkSidecar(
    sidecar([
      { selector: "a", copy: "One", bounding_box: box, obstacles: [box], index: 1 },
      { selector: "b", copy: "Two", index: 2 },
    ]),
    "board.en.dark.1280.json",
    { width: 1280 },
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].step, "board");
  assert.deepEqual(skipped, [2]);
  assert.deepEqual(calloutTexts(records), ["One"]);
});

test("both schema names parse, and only the earlier one is flagged", () => {
  const f = "board.en.dark.1280.json";
  const now = checkSidecar(sidecar([]), f);
  assert.equal(now.legacy, false);
  const old = checkSidecar({ ...sidecar([]), schema: "trackxai/raw-capture-sidecar@1" }, f);
  assert.equal(old.legacy, true);
  assert.deepEqual(old.records, now.records);
});

test("an unknown schema name fails with the file name", () => {
  const f = "board.en.dark.1280.json";
  assert.throws(
    () => checkSidecar({ ...sidecar([]), schema: "other/raw-capture-sidecar@1" }, f),
    /board\.en\.dark\.1280\.json: schema must be "docsxai\/raw-capture-sidecar@1"/,
  );
});

test("a bad sidecar fails with its file name", () => {
  const f = "board.en.dark.1280.json";
  assert.throws(() => checkSidecar({ annotations: [] }, f), /board\.en\.dark\.1280\.json: schema/);
  assert.throws(
    () => checkSidecar(sidecar([{ selector: "a", copy: "" }]), f),
    /board\.en\.dark\.1280\.json: annotation 1: copy/,
  );
  assert.throws(
    () => checkSidecar(sidecar([{ selector: "a", copy: "x", bounding_box: { x: 1 } }]), f),
    /annotation 1: bounding_box/,
  );
  assert.throws(
    () => checkSidecar(sidecar([{ selector: "a", copy: "x", obstacles: [{}] }]), f),
    /annotation 1: obstacle 1/,
  );
  assert.throws(() => checkSidecar(sidecar([]), f, { width: 390 }), /viewport.width 1280/);
});

test("callouts list numbered copy in index order", () => {
  const records = [
    { copy: "Two", index: 2, bounding_box: box },
    { copy: "One", index: 1, bounding_box: box },
  ];
  assert.deepEqual(calloutTexts(records), ["One", "Two"]);
});

test("the manifest merge replaces only the burned variants and keeps alt text", () => {
  const before = {
    schema: "docsxai/screens-pack@1",
    screens: {
      board: {
        alt: "Board alt",
        variants: {
          "en.dark.1280": { src: "/screens/desktop-1280/board.aaaaaaaa.png" },
          "es.dark.1280": { src: "/screens/desktop-1280/board.bbbbbbbb.png" },
        },
      },
      waiting: { alt: "Waiting alt", variants: { "en.dark.1280": { src: "/screens/w.png" } } },
    },
  };
  const value = { src: "/screens/desktop-1280/board.cccccccc.png", width: 1280 };
  const { manifest, superseded } = mergeManifest(before, [
    { screen: "board", variant: "en.dark.1280", value },
    { screen: "progress", variant: "en.dark.390", value: { src: "/screens/mobile-390/p.png" } },
  ]);
  assert.equal(manifest.screens.board.alt, "Board alt");
  assert.deepEqual(manifest.screens.board.variants["en.dark.1280"], value);
  assert.equal(
    manifest.screens.board.variants["es.dark.1280"].src,
    "/screens/desktop-1280/board.bbbbbbbb.png",
  );
  assert.deepEqual(manifest.screens.waiting, before.screens.waiting);
  assert.deepEqual(Object.keys(manifest.screens), ["board", "waiting", "progress"]);
  assert.deepEqual(superseded, ["/screens/desktop-1280/board.aaaaaaaa.png"]);
  assert.equal(before.screens.board.variants["en.dark.1280"].src.endsWith("aaaaaaaa.png"), true);
  assert.throws(() => mergeManifest({ schema: "x" }, []), /manifest: schema/);
});

test("coverage names what a caption covers", () => {
  const records = [
    { index: 1, copy: "a", bounding_box: { x: 0, y: 0, width: 10, height: 10 }, obstacles: [box] },
    { index: 2, copy: "b", bounding_box: { x: 100, y: 100, width: 10, height: 10 } },
  ];
  const clear = [
    {
      callout: { x: 50, y: 50, width: 10, height: 10 },
      badge: { x: 70, y: 70, width: 5, height: 5 },
    },
    { callout: { x: 200, y: 200, width: 10, height: 10 } },
  ];
  assert.deepEqual(coverage(records, clear), []);
  const covered = [
    { callout: { x: 0, y: 0, width: 105, height: 105 } },
    {
      callout: { x: 100, y: 100, width: 10, height: 10 },
      badge: { x: 1, y: 1, width: 2, height: 2 },
    },
  ];
  assert.deepEqual(coverage(records, covered), [
    "caption 1 covers 12 px² of listed text",
    "caption 1 covers the target of caption 2",
    "caption 1 overlaps caption 2",
    "caption 1 covers badge of caption 2",
  ]);
});

test("coverage flags phone chrome and badges on text", () => {
  const records = [
    {
      index: 1,
      copy: "a",
      bounding_box: box,
      obstacles: [{ x: 0, y: 100, width: 50, height: 20 }],
    },
  ];
  const report = [
    {
      callout: { x: 10, y: 10, width: 100, height: 30 },
      badge: { x: 10, y: 105, width: 10, height: 10 },
    },
  ];
  assert.deepEqual(coverage(records, report, { width: 390, height: 844 }), [
    "badge 1 covers 100 px² of listed text",
    "caption 1 is on the header",
  ]);
  assert.deepEqual(coverage(records, report, { width: 1280, height: 800 }), [
    "badge 1 covers 100 px² of listed text",
  ]);
  assert.deepEqual(badgeOnly([{}, { caption_style: "badge" }]), [2]);
});

test("badge-only frames come from the flag and the overrides file", () => {
  const set = badgeOnlyFrames("board.390", { badge_only: ["agent-tokens-issued.en.dark.390"] });
  const p = (screen, locale, width) => ({ screen, locale, theme: "dark", width });
  assert.equal(isBadgeOnly(set, p("board", "es", 390)), true);
  assert.equal(isBadgeOnly(set, p("board", "en", 1280)), false);
  assert.equal(isBadgeOnly(set, p("agent-tokens-issued", "en", 390)), true);
  assert.equal(isBadgeOnly(set, p("agent-tokens-issued", "es", 390)), false);
  assert.throws(() => badgeOnlyFrames("board", null), /badge-only: "board"/);
});

test("the WebP twin sits next to the PNG with the same stem", () => {
  assert.equal(
    webpTwinPath("/o/desktop-1280/board.ab12cd34.png"),
    "/o/desktop-1280/board.ab12cd34.webp",
  );
});

test("cwebp runs lossless at the slowest, smallest setting", () => {
  assert.deepEqual(cwebpArgs("in.png", "out.webp"), [
    "-lossless",
    "-z",
    "9",
    "-quiet",
    "in.png",
    "-o",
    "out.webp",
  ]);
});

test("a WebP twin is kept under 100 kB and smaller than the PNG", () => {
  assert.equal(WEBP_MAX_BYTES, 100_000);
  assert.deepEqual(webpVerdict("board.png", 180_000, 60_000), { keep: true });
  assert.deepEqual(webpVerdict("board.png", 99_999, 99_998), { keep: true });
});

test("a WebP twin of 100 kB or more is dropped with both sizes in the warning", () => {
  const v = webpVerdict("board.png", 400_000, 100_000);
  assert.equal(v.keep, false);
  assert.match(v.warning, /board\.png/);
  assert.match(v.warning, /webp 100\.0 kB/);
  assert.match(v.warning, /png 400\.0 kB/);
  assert.match(v.warning, /under 100 kB/);
});

test("a WebP twin no smaller than the PNG is dropped", () => {
  assert.equal(webpVerdict("a.png", 50_000, 50_000).keep, false);
  const v = webpVerdict("a.png", 50_000, 62_340);
  assert.equal(v.keep, false);
  assert.match(v.warning, /webp 62\.3 kB/);
  assert.match(v.warning, /png 50\.0 kB/);
  assert.match(v.warning, /smaller than the png/);
});

test("the capture ratio comes from the flag, the sidecar or the PNG width", () => {
  const base = { cssWidth: 390, pngWidth: 780, file: "a.png" };
  assert.equal(captureRatio({ ...base, doc: {} }), 2);
  assert.equal(captureRatio({ ...base, doc: { device_scale_factor: 2 } }), 2);
  assert.equal(captureRatio({ ...base, flag: "2", doc: {} }), 2);
  assert.equal(captureRatio({ cssWidth: 390, pngWidth: 390, file: "a.png" }), 1);
  assert.throws(() => captureRatio({ ...base, flag: "1", doc: {} }), /780 px wide, not 390/);
  assert.throws(() => captureRatio({ ...base, flag: "5", doc: {} }), /between 1 and 4/);
});

test("phone chrome bands grow with the ratio and a 2x desktop has none", () => {
  assert.deepEqual(
    chromeBands({ width: 780, height: 1688, dpr: 2 }).map((b) => b.box),
    [
      { x: 0, y: 0, width: 780, height: 112 },
      { x: 0, y: 1576, width: 780, height: 112 },
    ],
  );
  assert.deepEqual(chromeBands({ width: 2560, height: 1600, dpr: 2 }), []);
  assert.equal(chromeBands({ width: 390, height: 844 })[0].box.height, 56);
  const records = [{ index: 1, copy: "a", bounding_box: { x: 0, y: 0, width: 5, height: 5 } }];
  const report = [{ callout: { x: 10, y: 80, width: 100, height: 40 } }];
  assert.deepEqual(coverage(records, report, { width: 780, height: 1688, dpr: 2 }), [
    "caption 1 is on the header",
  ]);
  assert.deepEqual(coverage(records, report, { width: 780, height: 1688 }), []);
});

test("manifest variants keep CSS size and add the PNG size only at 2x", () => {
  const common = { src: "/screens/m/a.png", bytes: 9, callouts: ["x"] };
  assert.deepEqual(variantValue({ ...common, png: { width: 780, height: 1688 }, dpr: 2 }), {
    src: "/screens/m/a.png",
    width: 390,
    height: 844,
    png_width: 780,
    png_height: 1688,
    bytes: 9,
    callouts: ["x"],
  });
  assert.deepEqual(variantValue({ ...common, png: { width: 390, height: 844 }, dpr: 1 }), {
    src: "/screens/m/a.png",
    width: 390,
    height: 844,
    bytes: 9,
    callouts: ["x"],
  });
});
