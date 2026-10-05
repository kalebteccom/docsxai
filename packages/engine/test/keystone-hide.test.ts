// Keystone for the `hide` / `show` steps and the per-step `timeout_ms`: real Chromium, the toy-site
// hide page, the real runtime and driver.
//
// Claims: hidden elements are absent from the screenshot bytes (a light-DOM block and a shadow-DOM
// badge); nothing else on the page changes, pixel for pixel, and the content below the hidden block
// keeps its box; the hiding survives a reload; `show` brings back exactly the original image; and an
// optional step whose target is missing is skipped within its short budget, not after the 30 s default.
//
// Needs Chromium (see keystone.test.ts); skips without it.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { runFlow, type RunFlowResult } from "../src/flow-runtime.js";
import { launchPlaywrightSession, type PlaywrightSession } from "../src/playwright-driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const toySiteUrl = pathToFileURL(path.join(fixturesDir, "toy-site")).href + "/";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

// Rectangles of the hide page in CSS px (viewport 800x600, dpr 1 headless, so device px 1:1).
const COOKIE = { x: 0, y: 50, width: 800, height: 80 };
const BADGE = { x: 720, y: 540, width: 60, height: 40 };
const WHITE = [255, 255, 255, 255];

type Rect = { x: number; y: number; width: number; height: number };
const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

describe.skipIf(!chromiumAvailable)("keystone — hide / show / timeout_ms", () => {
  let tmp = "";
  let session: PlaywrightSession;
  let result: RunFlowResult;

  const shot = async (step: string) =>
    fs.readFile(path.join(tmp, "docs", "hide", "screenshots", `${step}.png`));
  const decode = async (step: string) => PNG.sync.read(await shot(step));
  const pixel = (img: PNG, x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
  const boxOf = (step: string) =>
    result.annotations.annotations.find((a) => a.step === step)?.bounding_box;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-hide-"));
    const flow = parseFlowFile(await fs.readFile(path.join(fixturesDir, "hide.flow.yaml"), "utf8"));
    session = await launchPlaywrightSession({
      baseURL: toySiteUrl,
      docPackRoot: tmp,
      environment: flow.environment,
    });
    result = await runFlow(flow, session.driver);
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    await fs.rm(tmp, { recursive: true, force: true });
    // 120s hook budget: the browser's graceful shutdown can take ~30s on macOS headless.
  }, 120_000);

  it("the visible shot shows both elements, so the checks below are not vacuous", async () => {
    const img = await decode("shot-visible");
    expect(pixel(img, 400, 90)).toEqual([255, 0, 0, 255]); // #cookie, red
    expect(pixel(img, 750, 560)).toEqual([255, 0, 255, 255]); // shadow badge, magenta
  });

  it("hidden elements are absent from the screenshot bytes", async () => {
    const img = await decode("shot-hidden");
    for (const r of [COOKIE, BADGE]) {
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) {
          if (pixel(img, x, y).join() !== WHITE.join())
            throw new Error(`pixel ${x},${y} not page background`);
        }
      }
    }
  });

  it("layout is unchanged: every pixel outside the hidden elements is identical, and the boxes below stay put", async () => {
    const visible = await decode("shot-visible");
    const hidden = await decode("shot-hidden");
    expect([hidden.width, hidden.height]).toEqual([visible.width, visible.height]);
    let differing = 0;
    for (let y = 0; y < visible.height; y++) {
      for (let x = 0; x < visible.width; x++) {
        if (pixel(visible, x, y).join() === pixel(hidden, x, y).join()) continue;
        differing++;
        if (!inside(COOKIE, x, y) && !inside(BADGE, x, y))
          throw new Error(`pixel ${x},${y} changed outside the hidden elements`);
      }
    }
    expect(differing).toBeGreaterThan(0);
    expect(boxOf("shot-hidden")).toEqual(boxOf("shot-visible"));
    expect(boxOf("shot-hidden")).toMatchObject({ y: 130, height: 60 });
  });

  it("the hiding survives a reload", async () => {
    expect((await shot("shot-after-reload")).equals(await shot("shot-hidden"))).toBe(true);
  });

  it("show restores exactly the original image", async () => {
    expect((await shot("shot-restored")).equals(await shot("shot-visible"))).toBe(true);
  });

  it("the optional hide with a missing target was skipped: no executed record", () => {
    expect(result.steps.map((s) => s.id)).not.toContain("hide-missing");
    expect(result.steps.map((s) => s.id)).toContain("hide-cookie");
  });

  it(
    "optional steps with a missing target return within their short budget, not the 30 s default",
    { timeout: 60_000 },
    async () => {
      const flow = parseFlowFile(`
name: probes
steps:
  - { id: open, action: navigate, value: hide.html, wait_for: load }
  - { id: p1, action: hide, target: '#absent-1', optional: true, timeout_ms: 300 }
  - { id: p2, action: click, target: '#absent-2', optional: true, timeout_ms: 300 }
  - { id: p3, action: fill, target: '#absent-3', value: x, optional: true, timeout_ms: 300 }
  - { id: p4, action: wait, wait_for: { selector: '#absent-4' }, optional: true, timeout_ms: 300 }
`);
      const start = Date.now();
      const r = await runFlow(flow, session.driver, { captureDocs: false });
      const elapsed = Date.now() - start;
      expect(r.steps.map((s) => s.id)).toEqual(["open"]);
      // Four misses at 300 ms each plus a navigation. The default would cost 4 x 30 s.
      expect(elapsed).toBeLessThan(8_000);
    },
  );

  it(
    "a non-optional hide on a missing target still halts, within its budget",
    { timeout: 60_000 },
    async () => {
      const flow = parseFlowFile(`
name: halts
steps:
  - { id: h, action: hide, target: '#absent', timeout_ms: 300 }
`);
      const start = Date.now();
      await expect(runFlow(flow, session.driver, { captureDocs: false })).rejects.toThrow(
        /step "h" \(hide\)/,
      );
      expect(Date.now() - start).toBeLessThan(8_000);
    },
  );
});
