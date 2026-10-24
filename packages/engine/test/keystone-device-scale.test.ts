// Keystone for `--device-scale-factor`: real Chromium, the toy-site obstacles page, driven through
// `docsxai run`. At factor 2 the screenshot is twice the CSS viewport in each direction, the
// annotation box and obstacles are in those device pixels, and annotations.json says so. Without
// the flag the doc pack is what it was before the flag existed.
//
// Needs Chromium (see keystone.test.ts); skips without it.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cmdRun } from "../src/cli-commands-session.js";
import { type AnnotationsFile } from "../src/doc-pack.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const toySiteUrl = pathToFileURL(path.join(fixturesDir, "toy-site")).href + "/";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

interface Pack {
  annotationsText: string;
  annotations: AnnotationsFile;
  screenshot: Buffer;
}

let tmp = "";
let runs = 0;

/** A fresh workspace running the obstacles flow (1000 by 700 CSS px viewport) with `extra` run args. */
async function runWorkspace(extra: string[]): Promise<Pack> {
  const ws = path.join(tmp, `ws-${runs++}`);
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.copyFile(
    path.join(fixturesDir, "obstacles.flow.yaml"),
    path.join(ws, "flows", "obstacles.flow.yaml"),
  );
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify({
      schema: "docsxai/workspace@1",
      app_url: toySiteUrl,
      created_at: "2030-01-01T00:00:00.000Z",
      annotations: { obstacles: true },
    }),
  );
  expect(await cmdRun([ws, ...extra])).toBe(0);
  const flowDir = path.join(ws, "docs", "obstacles");
  const annotationsText = await fs.readFile(path.join(flowDir, "annotations.json"), "utf8");
  return {
    annotationsText,
    annotations: JSON.parse(annotationsText) as AnnotationsFile,
    screenshot: await fs.readFile(path.join(flowDir, "screenshots", "share.png")),
  };
}

/** PNG size from the IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  const i = png.indexOf(Buffer.from("IHDR"));
  return { width: png.readUInt32BE(i + 4), height: png.readUInt32BE(i + 8) };
}

let at2: Promise<Pack> | undefined;
const factor2 = () => (at2 ??= runWorkspace(["--device-scale-factor", "2"]));

describe.skipIf(!chromiumAvailable)("keystone, device scale factor", () => {
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-dsf-"));
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it(
    "at 2 the PNG is twice the CSS viewport and the boxes are in its pixels",
    // 120s headroom: each run launches and gracefully closes a real Chromium.
    { timeout: 120_000 },
    async () => {
      const { annotations, screenshot } = await factor2();
      expect(pngSize(screenshot)).toEqual({ width: 2000, height: 1400 });
      expect(annotations.device_scale_factor).toBe(2);
      const [ann] = annotations.annotations;
      // CSS rect {300, 200, 100, 30}, doubled.
      expect(ann!.bounding_box).toEqual({ x: 600, y: 400, width: 200, height: 60 });
      expect(ann!.obstacles!.length).toBeGreaterThan(0);
      for (const o of ann!.obstacles!) {
        expect(o.x + o.width).toBeLessThanOrEqual(2000);
        expect(o.y + o.height).toBeLessThanOrEqual(1400);
      }
    },
  );

  it("is byte-identical across two runs at 2", { timeout: 240_000 }, async () => {
    const a = await factor2();
    const b = await runWorkspace(["--device-scale-factor", "2"]);
    expect(b.annotationsText).toBe(a.annotationsText);
    expect(b.screenshot.equals(a.screenshot)).toBe(true);
  });

  it(
    "without the flag, and at 1, the pack carries no device_scale_factor and the PNG is 1x",
    { timeout: 240_000 },
    async () => {
      const unset = await runWorkspace([]);
      const one = await runWorkspace(["--device-scale-factor", "1"]);
      expect(unset.annotationsText).not.toContain("device_scale_factor");
      expect(pngSize(unset.screenshot)).toEqual({ width: 1000, height: 700 });
      expect(one.annotationsText).toBe(unset.annotationsText);
      expect(one.screenshot.equals(unset.screenshot)).toBe(true);
    },
  );
});
