// node --test scripts/landing-showcase-plan.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHONE_MEDIA,
  assetName,
  contentHash,
  parseAssetName,
  pictureFor,
  pipelineLayout,
  runTranscript,
  staleFiles,
  wrapMono,
} from "./landing-showcase-plan.mjs";

test("asset names round-trip and reject anything off-plan", () => {
  const name = assetName("pipeline", "dark", 1280, "0a1b2c3d", "png");
  assert.equal(name, "pipeline-dark-1280.0a1b2c3d.png");
  assert.deepEqual(parseAssetName(name), {
    shot: "pipeline",
    theme: "dark",
    width: 1280,
    hash: "0a1b2c3d",
    ext: "png",
  });
  assert.equal(parseAssetName("og.png"), null);
  assert.equal(parseAssetName("pipeline-dark-1280.0A1B2C3D.png"), null);
  assert.throws(() => assetName("hero", "dark", 1280, "0a1b2c3d", "png"), /unknown shot/);
  assert.throws(() => assetName("terminal", "sepia", 390, "0a1b2c3d", "png"), /unknown theme/);
  assert.throws(() => assetName("terminal", "light", 800, "0a1b2c3d", "png"), /unknown width/);
  assert.throws(() => assetName("terminal", "light", 390, "abc", "png"), /8 hex/);
  assert.throws(() => assetName("terminal", "light", 390, "0a1b2c3d", "jpg"), /png or webp/);
});

test("the hash is the first 8 hex of the SHA-256", () => {
  assert.equal(contentHash(Buffer.from("")), "e3b0c442");
  assert.match(contentHash(Buffer.from("x")), /^[0-9a-f]{8}$/);
});

test("stale files are this script's names that the new run did not write", () => {
  const keep = ["pipeline-dark-1280.11111111.png", "pipeline-dark-1280.11111111.webp"];
  const existing = [
    ...keep,
    "pipeline-dark-1280.22222222.png",
    "pipeline-dark-1280.22222222.webp",
    "manifest.json",
    "notes.txt",
  ];
  assert.deepEqual(staleFiles(existing, keep), [
    "pipeline-dark-1280.22222222.png",
    "pipeline-dark-1280.22222222.webp",
  ]);
});

test("pipeline panels crop the same rectangle and fit the image", () => {
  for (const width of [1280, 390]) {
    const L = pipelineLayout(width);
    assert.equal(L.width, width);
    const [raw, burned] = L.panels;
    assert.equal(raw.kind, "raw");
    assert.equal(burned.kind, "burned");
    assert.equal(raw.width, burned.width);
    assert.equal(raw.height, burned.height);
    assert.equal(raw.height, Math.round(L.crop.height * L.scale));
    for (const p of L.panels) {
      assert.ok(p.x >= 0 && p.x + p.width <= L.width, `${width}: panel inside the width`);
      assert.ok(p.y >= L.label.height && p.y + p.height <= L.height, `${width}: room for a label`);
    }
  }
  assert.equal(pipelineLayout(1280).direction, "row");
  assert.equal(pipelineLayout(390).direction, "column");
  assert.throws(() => pipelineLayout(800), /no pipeline layout/);
});

test("the run transcript matches the engine's progress and summary lines", () => {
  const lines = runTranscript("workspace/", [
    { flow: "screens", variant: "en-US.dark.desktop-1280", steps: 61, annotations: 29 },
    { flow: "screens", variant: "en-US.dark.mobile-390", steps: 53, annotations: 18 },
  ]);
  assert.deepEqual(lines, [
    "run: screens/en-US.dark.desktop-1280 — starting",
    "run: screens/en-US.dark.desktop-1280 — 61 step(s) executed, 29 annotation(s) written",
    "run: screens/en-US.dark.mobile-390 — starting",
    "run: screens/en-US.dark.mobile-390 — 53 step(s) executed, 18 annotation(s) written",
    "run: 2 of 2 flow variants ok, outputs in workspace/docs",
  ]);
  const one = runTranscript("my-docs", [
    { flow: "publish", variant: null, steps: 4, annotations: 3 },
  ]);
  assert.equal(one.at(-1), "run: 1 of 1 flow ok, outputs in my-docs/docs");
  assert.throws(() => runTranscript("w", []), /at least one/);
});

test("wrapMono breaks at spaces, indents continuations and keeps every character", () => {
  const line =
    "run: screens/en-US.light.desktop-1280 — 61 step(s) executed, 29 annotation(s) written";
  const rows = wrapMono(line, 40);
  assert.ok(rows.every((r) => r.length <= 40));
  assert.ok(rows.slice(1).every((r) => r.startsWith("  ")));
  assert.equal(rows.map((r) => r.trim()).join(" "), line);
  assert.deepEqual(wrapMono("short", 40), ["short"]);
  assert.deepEqual(wrapMono("abcdefghij", 4, 1), ["abcd", " efg", " hij"]);
  assert.throws(() => wrapMono("x", 2, 2), /no room/);
});

test("pictureFor gives phones the 390 files and everyone else the 1280 ones", () => {
  const f = (name, width, height) => ({ name, width, height });
  const pic = pictureFor(
    {
      "1280.png": f("a-1280.png", 1280, 518),
      "1280.webp": f("a-1280.webp", 1280, 518),
      "390.png": f("a-390.png", 390, 760),
      "390.webp": f("a-390.webp", 390, 760),
    },
    "/showcase",
  );
  assert.deepEqual(pic.sources, [
    {
      media: PHONE_MEDIA,
      type: "image/webp",
      srcset: "/showcase/a-390.webp",
      width: 390,
      height: 760,
    },
    {
      media: PHONE_MEDIA,
      type: "image/png",
      srcset: "/showcase/a-390.png",
      width: 390,
      height: 760,
    },
    { type: "image/webp", srcset: "/showcase/a-1280.webp", width: 1280, height: 518 },
  ]);
  assert.deepEqual(pic.img, { src: "/showcase/a-1280.png", width: 1280, height: 518 });
  assert.throws(() => pictureFor({}, "/showcase"), /no 390\.webp file/);
});
