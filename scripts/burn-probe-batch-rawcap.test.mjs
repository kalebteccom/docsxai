// Pins the raw capture layout that remotxai's docs-screens run writes (stage-metadata.ts and
// website/scripts/screens/raw-input.mjs there): <flow>/flow.json, <flow>/<step>/step.json and
// <flow>/<step>/<en|es>.<light|dark>.<390|1280>.png with a .json sidecar of
// { width, height, annotations: [{ index, copy, bbox, arrow_style?, nudge?, obstacles? }] }.
// The probe also accepts a named viewport ending in the width (mobile-390), checked here too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectLayout, listFrames, readSidecar, selectFrames } from "./burn-probe-batch-plan.mjs";

const bbox = { x: 10, y: 20, width: 100, height: 40 };
const sidecar = (width, height) => ({
  width,
  height,
  annotations: [
    {
      index: 1,
      copy: "Pay now",
      bbox,
      arrow_style: "bottom",
      nudge: { x: 2, y: -3 },
      obstacles: [{ x: 0, y: 0, width: 50, height: 10 }],
    },
    { index: 2, copy: "Total", bbox },
  ],
});

async function build(root) {
  const put = (rel, body) =>
    mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() =>
      writeFile(path.join(root, rel), body),
    );
  await put("checkout/flow.json", JSON.stringify({ title: { en: "Checkout", es: "Pago" } }));
  await put("checkout/pay/step.json", JSON.stringify({ caption: {}, alt: {} }));
  for (const [key, w, h] of [
    ["en.light.390", 390, 780],
    ["en.dark.390", 390, 780],
    ["es.dark.390", 390, 780],
    ["en.dark.1280", 1280, 800],
    ["es.light.1280", 1280, 800],
  ]) {
    await put(`checkout/pay/${key}.png`, "png");
    await put(`checkout/pay/${key}.json`, JSON.stringify(sidecar(w, h)));
  }
  await put("checkout/review/en.dark.mobile-390.png", "png");
  await put("checkout/review/en.dark.mobile-390.json", JSON.stringify(sidecar(390, 780)));
  await put("checkout/review/en.dark.desktop-1280.png", "png");
  await put("checkout/review/en.dark.desktop-1280.json", JSON.stringify(sidecar(1280, 800)));
  // Not frames.
  await put("MANIFEST", "x");
  await put("MANIFEST.json", "{}");
  await put("manifest.json", "{}");
  await put("README.txt", "x");
  await put("checkout/pay/notes.txt", "x");
  await put("checkout/pay/failure.png", "x");
  await put("checkout/pay/en.dark.json", "{}");
  await put("checkout/pay/en.sepia.390.png", "x");
  await put("checkout/pay/en.dark.390.png.bak", "x");
  await put("checkout/pay/extra/en.dark.390.png", "x");
  await put("loose.png", "x");
}

async function withTree(fn) {
  const root = await mkdtemp(path.join(tmpdir(), "rawcap-"));
  try {
    await build(root);
    const files = (await readdir(root, { recursive: true })).map((f) => f.split("\\").join("/"));
    await fn(root, listFrames(files));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("rawcap layout is detected and only real frames are listed", async () => {
  await withTree((_root, frames) => {
    assert.equal(detectLayout(frames), "rawcap");
    assert.deepEqual(
      frames.map((f) => f.label),
      [
        "checkout/pay/en.dark.1280",
        "checkout/pay/en.dark.390",
        "checkout/pay/en.light.390",
        "checkout/pay/es.dark.390",
        "checkout/pay/es.light.1280",
        "checkout/review/en.dark.1280",
        "checkout/review/en.dark.390",
      ],
    );
  });
});

test("locale, theme and width are parsed from the file name", async () => {
  await withTree((_root, frames) => {
    const by = Object.fromEntries(frames.map((f) => [f.label, f]));
    assert.deepEqual(by["checkout/pay/es.dark.390"], {
      layout: "rawcap",
      label: "checkout/pay/es.dark.390",
      screen: "checkout/pay",
      locale: "es",
      theme: "dark",
      width: 390,
      png: "checkout/pay/es.dark.390.png",
      json: "checkout/pay/es.dark.390.json",
    });
    assert.equal(by["checkout/pay/en.dark.1280"].width, 1280);
    assert.equal(by["checkout/pay/es.light.1280"].theme, "light");
    // Named viewports reduce to their width; the label drops the name.
    assert.equal(by["checkout/review/en.dark.390"].png, "checkout/review/en.dark.mobile-390.png");
    assert.equal(
      by["checkout/review/en.dark.1280"].png,
      "checkout/review/en.dark.desktop-1280.png",
    );
  });
});

test("selectFrames filters by locale, theme and width", async () => {
  await withTree((_root, frames) => {
    const pick = (o) => selectFrames(frames, o).map((f) => f.label);
    assert.deepEqual(pick({ theme: "dark", locale: "es", widths: [390, 1280] }), [
      "checkout/pay/es.dark.390",
    ]);
    assert.deepEqual(pick({ theme: "dark", locale: "en", widths: [1280] }), [
      "checkout/pay/en.dark.1280",
      "checkout/review/en.dark.1280",
    ]);
  });
});

test("a real-shaped sidecar reads as rawcap records for every frame", async () => {
  await withTree(async (root, frames) => {
    for (const frame of frames) {
      const doc = JSON.parse(await readFile(path.join(root, frame.json), "utf8"));
      const { records, skipped } = readSidecar(doc, frame.json, frame);
      assert.deepEqual(skipped, []);
      assert.equal(records.length, 2);
      assert.equal(records[0].step, frame.screen);
      assert.deepEqual(records[0].bounding_box, bbox);
      assert.equal(records[0].arrow_style, "bottom");
      assert.deepEqual(records[0].nudge, { x: 2, y: -3 });
      assert.equal(records[0].obstacles.length, 1);
    }
  });
});

test("a sidecar width that disagrees with the file name is rejected", () => {
  const frame = { screen: "checkout/pay", width: 390 };
  assert.throws(() => readSidecar(sidecar(1280, 800), "x.json", frame), /does not match/);
});
