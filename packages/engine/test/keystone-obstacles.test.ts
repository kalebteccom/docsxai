// Keystone for `annotations.obstacles`: real Chromium, the toy-site obstacles page, driven through
// `docsxai run` so the `.docsxai.json` setting, the runtime, the driver and the written
// `annotations.json` are all the real ones.
//
// Claims: with the setting on, annotations carry obstacles in screenshot pixels (target left out,
// hidden and far content left out); with it off or absent the doc pack is exactly what it was
// before the field existed; either way, two runs write identical bytes.
//
// Needs Chromium (see keystone.test.ts); skips without it.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cmdRun } from "../src/cli-commands-session.js";
import { type AnnotationsFile, type BoundingBox } from "../src/doc-pack.js";
import { OBSTACLE_LIMIT } from "../src/obstacles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const toySiteUrl = pathToFileURL(path.join(fixturesDir, "toy-site")).href + "/";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

type Setting = { annotations: { obstacles: boolean } } | undefined;

interface Pack {
  annotationsText: string;
  annotations: AnnotationsFile;
  screenshot: Buffer;
}

let tmp = "";
let runs = 0;

/** A fresh workspace running the obstacles flow with `setting` in `.docsxai.json`, then `docsxai run`. */
async function runWorkspace(setting: Setting): Promise<Pack> {
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
      ...setting,
    }),
  );
  expect(await cmdRun([ws])).toBe(0);
  const flowDir = path.join(ws, "docs", "obstacles");
  const annotationsText = await fs.readFile(path.join(flowDir, "annotations.json"), "utf8");
  return {
    annotationsText,
    annotations: JSON.parse(annotationsText) as AnnotationsFile,
    screenshot: await fs.readFile(path.join(flowDir, "screenshots", "share.png")),
  };
}

// Run once and share: the first test to need it pays for the browser.
let onRun: Promise<Pack> | undefined;
const withObstacles = () => (onRun ??= runWorkspace({ annotations: { obstacles: true } }));

const overlaps = (a: BoundingBox, b: BoundingBox) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe.skipIf(!chromiumAvailable)("keystone — annotation obstacles", () => {
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-obstacles-"));
  });
  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it(
    "writes obstacles in screenshot pixels: neighbouring text and links in, the target, hidden and far content out",
    // 120s headroom: each run launches and gracefully closes a real Chromium (~30s teardown on
    // macOS headless).
    { timeout: 120_000 },
    async () => {
      const { annotations } = await withObstacles();
      const [ann] = annotations.annotations;
      expect(annotations.annotations).toHaveLength(1);
      const target = ann!.bounding_box!;
      const obstacles = ann!.obstacles!;
      expect(target).toEqual({ x: 300, y: 200, width: 100, height: 30 }); // dpr 1: CSS px = screenshot px

      expect(obstacles.length).toBeGreaterThan(0);
      expect(obstacles.length).toBeLessThanOrEqual(OBSTACLE_LIMIT);
      for (const o of obstacles) {
        expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.y).toBeGreaterThanOrEqual(0);
        expect(o.x + o.width).toBeLessThanOrEqual(1000);
        expect(o.y + o.height).toBeLessThanOrEqual(700);
        expect(overlaps(o, target)).toBe(false); // the target's own label is not an obstacle
      }
      const region = (x: number, y: number, width: number, height: number) =>
        obstacles.filter((o) => overlaps(o, { x, y, width, height }));
      expect(region(20, 200, 260, 40).length).toBeGreaterThan(0); // the notes paragraph, per line
      expect(region(430, 205, 120, 20).length).toBeGreaterThan(0); // the help link
      expect(region(300, 150, 320, 40).length).toBeGreaterThan(0); // text above the button
      expect(region(300, 245, 320, 20).length).toBeGreaterThan(0); // text below it
      expect(region(20, 320, 300, 20)).toEqual([]); // display:none draft
      expect(region(880, 650, 120, 20)).toEqual([]); // footer, beyond the radius

      const order = (a: BoundingBox, b: BoundingBox) =>
        a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;
      expect(obstacles).toEqual([...obstacles].sort(order));
    },
  );

  it("is byte-identical across two runs with the setting on", { timeout: 240_000 }, async () => {
    const a = await withObstacles();
    const b = await runWorkspace({ annotations: { obstacles: true } });
    expect(b.annotationsText).toBe(a.annotationsText);
    expect(b.screenshot.equals(a.screenshot)).toBe(true);
  });

  it(
    "leaves the doc pack as it was before the field existed with the setting absent or false",
    // three browsers when this test runs alone
    { timeout: 300_000 },
    async () => {
      const on = await withObstacles();
      const absent = await runWorkspace(undefined);
      const off = await runWorkspace({ annotations: { obstacles: false } });

      expect(absent.annotationsText).not.toContain('"obstacles":');
      expect(off.annotationsText).toBe(absent.annotationsText);
      expect(off.screenshot.equals(absent.screenshot)).toBe(true);

      // Turning it on adds the field and changes nothing else, screenshot included.
      const stripped = structuredClone(on.annotations);
      for (const a of stripped.annotations) delete a.obstacles;
      expect(JSON.stringify(stripped, null, 2) + "\n").toBe(absent.annotationsText);
      expect(on.screenshot.equals(absent.screenshot)).toBe(true);
    },
  );
});
