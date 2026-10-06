// Matrix keystone: a 2x2 matrix (locales x color schemes) runs through the real `docsxai run` path on
// real Chromium against the toy site. Proves each variant lands in its own directory with its own
// bytes, that two independent runs write identical bytes, and that a flow without a matrix still
// writes the flat layout.
//
// Needs a Chromium binary (see keystone.test.ts); without one the suite skips.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const toySiteUrl = pathToFileURL(path.join(fixturesDir, "toy-site")).href + "/";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const IDS = [
  "en-US.light.compact",
  "en-US.dark.compact",
  "es-ES.light.compact",
  "es-ES.dark.compact",
];

/** A workspace holding one fixture flow, run through the CLI against the toy site. */
async function runWorkspace(root: string, fixture: string): Promise<string> {
  const ws = path.join(root, "ws");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.copyFile(
    path.join(fixturesDir, fixture),
    path.join(ws, "flows", fixture.replace(/^.*\//, "")),
  );
  const code = await main(["run", ws, "--base-url", toySiteUrl, "--concurrency", "2"]);
  expect(code).toBe(0);
  return ws;
}

/** Every file under `dir`, relative, sorted, with its sha256. */
async function digest(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await digest(dir, r));
    else
      out[r] = createHash("sha256")
        .update(await fs.readFile(path.join(dir, r)))
        .digest("hex");
  }
  return out;
}

interface AnnotationsJson {
  flow: string;
  variant: unknown;
  annotations: Array<{ step: string; copy: string }>;
}
const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf8")) as AnnotationsJson;

describe.skipIf(!chromiumAvailable)("keystone: flow matrix", () => {
  it(
    "runs a 2x2 matrix into four variant directories with distinct outputs, identical across two runs",
    // Each run starts four Chromium sessions (two at a time) and closes them; two runs.
    { timeout: 300_000 },
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-matrix-"));
      try {
        const ws1 = await runWorkspace(path.join(tmp, "run1"), "matrix-2x2.flow.yaml");
        const ws2 = await runWorkspace(path.join(tmp, "run2"), "matrix-2x2.flow.yaml");
        const docs1 = path.join(ws1, "docs", "matrix-2x2");

        // Layout: only variant directories under the flow, nothing flat beside them.
        expect((await fs.readdir(docs1)).sort()).toEqual([...IDS].sort());

        // Each variant records itself and carries its locale's copy and its own steps.
        for (const id of IDS) {
          const ann = await readJson(path.join(docs1, id, "annotations.json"));
          const [locale, scheme] = id.split(".");
          expect(Object.keys(ann)).toEqual(["schema", "flow", "variant", "annotations"]);
          expect(ann.flow).toBe("matrix-2x2");
          expect(ann.variant).toEqual({
            id,
            locale,
            color_scheme: scheme,
            viewport: { name: "compact", width: 480, height: 360 },
          });
          const steps = ann.annotations.map((a) => a.step);
          expect(steps).toEqual(scheme === "dark" ? ["shot", "dark-note"] : ["shot"]);
          expect(ann.annotations[0]!.copy).toBe(
            locale === "es-ES" ? "Linea de idioma" : "Language line",
          );
          const shots = (await fs.readdir(path.join(docs1, id, "screenshots"))).sort();
          expect(shots).toEqual(scheme === "dark" ? ["dark-note.png", "shot.png"] : ["shot.png"]);
        }

        // Distinct outputs: the viewport applies, the scheme paints the background, the locale changes the text.
        const png = async (id: string) =>
          PNG.sync.read(await fs.readFile(path.join(docs1, id, "screenshots", "shot.png")));
        const corner = (img: PNG) => [
          img.data[4 * (img.width + 1)],
          img.data[4 * (img.width + 1) + 1],
          img.data[4 * (img.width + 1) + 2],
        ];
        for (const id of IDS) {
          const img = await png(id);
          expect(img.width).toBe(480);
          expect(img.height).toBe(360);
          expect(corner(img)).toEqual(id.includes(".dark.") ? [16, 24, 32] : [255, 255, 255]);
        }
        const hashes = await Promise.all(
          IDS.map(async (id) =>
            createHash("sha256")
              .update(await fs.readFile(path.join(docs1, id, "screenshots", "shot.png")))
              .digest("hex"),
          ),
        );
        expect(new Set(hashes).size).toBe(IDS.length);

        // Byte-identical across two independent runs: every PNG and every annotations.json.
        const a = await digest(path.join(ws1, "docs"));
        const b = await digest(path.join(ws2, "docs"));
        expect(Object.keys(a)).toHaveLength(IDS.length * 2 + 2);
        expect(b).toEqual(a);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "a flow without a matrix still writes the flat layout, with no variant key, identically across runs",
    { timeout: 240_000 },
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-flat-"));
      try {
        const ws1 = await runWorkspace(path.join(tmp, "run1"), "recap-open.flow.yaml");
        const ws2 = await runWorkspace(path.join(tmp, "run2"), "recap-open.flow.yaml");
        const flowDir = path.join(ws1, "docs", "recap-open");
        expect((await fs.readdir(flowDir)).sort()).toEqual(["annotations.json", "screenshots"]);
        expect(await fs.readdir(path.join(flowDir, "screenshots"))).toEqual(["open-sidebar.png"]);
        const ann = await readJson(path.join(flowDir, "annotations.json"));
        expect(Object.keys(ann)).toEqual(["schema", "flow", "annotations"]);
        expect(await digest(path.join(ws2, "docs"))).toEqual(await digest(path.join(ws1, "docs")));
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },
  );
});
