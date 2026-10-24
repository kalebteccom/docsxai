import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calloutTexts,
  checkSidecar,
  contentHash,
  mergeManifest,
  parseRawName,
  parseRename,
  variantDir,
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
  schema: "trackxai/raw-capture-sidecar@1",
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
