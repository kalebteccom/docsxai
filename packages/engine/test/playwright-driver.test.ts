// PlaywrightDriver regression tests for two doc-pack rendering bugs found in the 2026-05-19
// review of an attached-CDP run:
//   1. bbox was CSS-px but the screenshot is device-px → halo mispositioned (and the wrong
//      target rect threw the callout into a clamped sliver) on any dpr ≠ 1 (Retina/zoomed BYOB).
//   2. screenshots were captured mid-transition → "faded" half-rendered elements.
// (1) is Chromium-gated (needs a real deviceScaleFactor:2 context). (2) is a fast unit test
// over a fake Page asserting the screenshot options.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PNG } from "pngjs";
import { chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchPlaywrightSession, PlaywrightDriver } from "../src/playwright-driver.js";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

describe("PlaywrightDriver.screenshot — capture options (bug 3: mid-transition / faded shots)", () => {
  it("passes animations:'disabled' + caret:'hide' to page.screenshot so transitions are settled", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakePage = {
      screenshot: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return Buffer.from("");
      },
    } as unknown as Page;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pwd-"));
    try {
      const d = new PlaywrightDriver(fakePage, tmp);
      await d.screenshot("docs/f/screenshots/s.png");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ animations: "disabled", caret: "hide" });
      expect(String(calls[0]!.path)).toMatch(/docs\/f\/screenshots\/s\.png$/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!chromiumAvailable)(
  "PlaywrightDriver.boundingBox — device-pixel space (bug 1: dpr ≠ 1 mispositioning)",
  () => {
    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser.close();
      // 120s hook budget: a describe/test timeout does not cover hooks, and the
      // browser's graceful shutdown can take ~30s on macOS headless.
    }, 120_000);

    const FIXTURE = `data:text/html,${encodeURIComponent(
      `<!doctype html><html><body style="margin:0">
       <div id="box" style="position:fixed;left:100px;top:60px;width:200px;height:40px;background:#09c"></div>
     </body></html>`,
    )}`;

    it("dpr=1: bbox is the CSS rect unchanged (the headless default — must stay a no-op)", async () => {
      const ctx = await browser.newContext({
        viewport: { width: 1000, height: 700 },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      const d = new PlaywrightDriver(page);
      const bb = await d.boundingBox("#box");
      expect(bb).toEqual({ x: 100, y: 60, width: 200, height: 40 });
      await ctx.close();
    });

    it("dpr=2: bbox is the CSS rect × 2 — i.e. the screenshot's device-pixel space", async () => {
      const ctx = await browser.newContext({
        viewport: { width: 1000, height: 700 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      const d = new PlaywrightDriver(page);
      const bb = await d.boundingBox("#box");
      // CSS rect {100,60,200,40} × dpr 2 → device-pixel rect.
      expect(bb).toEqual({ x: 200, y: 120, width: 400, height: 80 });

      // And that device-pixel space is exactly what page.screenshot() produces:
      const png = await page.screenshot();
      // PNG IHDR width = viewport CSS width × deviceScaleFactor = 1000 × 2 = 2000.
      const i = png.indexOf(Buffer.from("IHDR"));
      expect(png.readUInt32BE(i + 4)).toBe(2000);
      // so bb.x (200) is in the same 0..2000 space the viewer scales against — correct.
      await ctx.close();
    });

    it("dpr=2: a region redaction (CSS px) lands at CSS × 2 in the screenshot — same space as selector bboxes", async () => {
      const ctx = await browser.newContext({
        viewport: { width: 1000, height: 700 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(FIXTURE);
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-redact-"));
      try {
        const d = new PlaywrightDriver(page, tmp);
        // The CSS rect of #box — must black out device px (200,120)–(600,200).
        await d.screenshot("docs/f/screenshots/s.png", [
          { region: { x: 100, y: 60, width: 200, height: 40 }, style: "box" },
        ]);
        const img = PNG.sync.read(await fs.readFile(path.join(tmp, "docs/f/screenshots/s.png")));
        const px = (x: number, y: number) => {
          const i = (y * img.width + x) * 4;
          return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
        };
        expect(px(400, 160)).toEqual([0, 0, 0, 255]); // center of the region, device px
        expect(px(201, 121)).toEqual([0, 0, 0, 255]); // just inside the top-left corner
        expect(px(150, 160)).not.toEqual([0, 0, 0, 255]); // left of the region — untouched
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
        await ctx.close();
      }
    });
  },
  // 120s: a real-Chromium session's graceful shutdown can take ~30s on macOS
  // headless (GPU/sandbox-helper teardown), which alone exhausts a 30s budget.
  120_000,
);

describe.skipIf(!chromiumAvailable)(
  "PlaywrightDriver.nearbyBoxes — what a callout must not cover",
  () => {
    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser.close();
    }, 120_000);

    const FIXTURE = `data:text/html,${encodeURIComponent(
      `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">
       <button id="target" style="position:absolute;left:300px;top:200px;width:100px;height:30px">Go <span id="inner">now</span></button>
       <p id="beside" style="position:absolute;left:20px;top:200px;width:200px;margin:0">Text beside the target</p>
       <a id="link" href="#x" style="position:absolute;left:450px;top:205px">A link</a>
       <p id="hidden" style="display:none;position:absolute;left:20px;top:300px">Hidden text</p>
       <p id="invisible" style="visibility:hidden;position:absolute;left:20px;top:330px;margin:0">Invisible text</p>
       <div style="position:absolute;left:20px;top:360px;width:60px;height:20px;overflow:hidden">
         <span style="position:absolute;left:0;top:100px">Clipped away</span>
       </div>
       <p id="far" style="position:absolute;left:900px;top:650px;margin:0">Far away</p>
       <script>document.body.style.height = "2000px"</script>
     </body></html>`,
    )}`;

    const scan = async (scale: number) => {
      const ctx = await browser.newContext({
        viewport: { width: 1000, height: 700 },
        deviceScaleFactor: scale,
      });
      try {
        const page = await ctx.newPage();
        await page.goto(FIXTURE);
        const result = await new PlaywrightDriver(page).nearbyBoxes("#target", 320, 2000);
        return { result };
      } finally {
        await ctx.close();
      }
    };
    /** Boxes overlapping a CSS-pixel region, after undoing the scale. */
    const hits = (boxes: BoundingBoxLike[], scale: number, r: BoundingBoxLike) =>
      boxes.filter((b) => {
        const [x, y, w, h] = [b.x / scale, b.y / scale, b.width / scale, b.height / scale];
        return x < r.x + r.width && x + w > r.x && y < r.y + r.height && y + h > r.y;
      });

    it.each([1, 2])(
      "dpr=%i: reports text and controls near the target, in screenshot pixels",
      async (dpr) => {
        const { result } = await scan(dpr);
        expect(result).not.toBeNull();
        expect(result!.scale).toBe(dpr);
        expect(result!.image).toEqual({ width: 1000 * dpr, height: 700 * dpr });
        const boxes = result!.boxes;
        expect(hits(boxes, dpr, { x: 20, y: 200, width: 200, height: 20 }).length).toBeGreaterThan(
          0,
        );
        expect(hits(boxes, dpr, { x: 450, y: 205, width: 60, height: 20 }).length).toBeGreaterThan(
          0,
        );
        // the beside paragraph's box is one text line (a glyph box inside the 20px line), scaled with the screenshot
        const beside = hits(boxes, dpr, { x: 20, y: 200, width: 200, height: 20 })[0]!;
        expect(beside.x).toBeCloseTo(20 * dpr, 0);
        expect(beside.height).toBeGreaterThan(12 * dpr);
        expect(beside.height).toBeLessThanOrEqual(20 * dpr);
      },
    );

    it("leaves out the target's own subtree, hidden, invisible and clipped content, and anything beyond the radius", async () => {
      const { result } = await scan(1);
      const boxes = result!.boxes;
      expect(hits(boxes, 1, { x: 300, y: 200, width: 100, height: 30 })).toEqual([]);
      expect(hits(boxes, 1, { x: 20, y: 300, width: 200, height: 20 })).toEqual([]);
      expect(hits(boxes, 1, { x: 20, y: 330, width: 200, height: 20 })).toEqual([]);
      expect(hits(boxes, 1, { x: 20, y: 360, width: 60, height: 20 })).toEqual([]);
      expect(hits(boxes, 1, { x: 900, y: 650, width: 100, height: 20 })).toEqual([]);
    });

    it("returns null when the target never becomes visible", async () => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      try {
        const page = await ctx.newPage();
        await page.goto(FIXTURE);
        expect(await new PlaywrightDriver(page).nearbyBoxes("#hidden", 320, 300)).toBeNull();
      } finally {
        await ctx.close();
      }
    });
  },
  120_000,
);

interface BoundingBoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CLOCK_FIXTURE = `data:text/html,${encodeURIComponent(
  `<!doctype html><html><body>
   <div id="clock"></div>
   <script>document.getElementById("clock").textContent = new Date().toISOString();</script>
 </body></html>`,
)}`;

describe.skipIf(!chromiumAvailable)(
  "launchPlaywrightSession — environment application",
  () => {
    it("freezes the page clock at environment.clock (deterministic dates in page text)", async () => {
      const session = await launchPlaywrightSession({
        environment: { clock: "2030-01-02T03:04:05Z" },
      });
      try {
        await session.driver.goto(CLOCK_FIXTURE);
        expect(await session.driver.textOf("#clock")).toContain("2030-01-02T03:04:05");
      } finally {
        await session.close();
      }
    });

    it("applies viewport preset, color_scheme, reduced_motion, locale, and timezone to the context", async () => {
      const session = await launchPlaywrightSession({
        environment: {
          viewport: "mobile",
          color_scheme: "dark",
          reduced_motion: true,
          locale: "en-GB",
          timezone: "Europe/Amsterdam",
        },
      });
      try {
        await session.driver.goto(CLOCK_FIXTURE);
        const probed = await session.page.evaluate(() => {
          const g = globalThis as unknown as {
            innerWidth: number;
            innerHeight: number;
            matchMedia: (q: string) => { matches: boolean };
            navigator: { language: string };
          };
          return {
            width: g.innerWidth,
            height: g.innerHeight,
            dark: g.matchMedia("(prefers-color-scheme: dark)").matches,
            reduced: g.matchMedia("(prefers-reduced-motion: reduce)").matches,
            language: g.navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        });
        expect(probed).toEqual({
          width: 390, // the `mobile` preset
          height: 844,
          dark: true,
          reduced: true,
          language: "en-GB",
          timezone: "Europe/Amsterdam",
        });
      } finally {
        await session.close();
      }
    });
  },
  // 120s: a real-Chromium session's graceful shutdown can take ~30s on macOS
  // headless (GPU/sandbox-helper teardown), which alone exhausts a 30s budget.
  120_000,
);

describe.skipIf(!chromiumAvailable)(
  "PlaywrightDriver.waitForElementStable — settles a CSS-animated element",
  () => {
    const ANIMATED_FIXTURE = `data:text/html,${encodeURIComponent(
      `<!doctype html><html><head><style>
       #box { position: fixed; left: 0; top: 50px; width: 60px; height: 30px; background: #09c;
              animation: slide 0.6s linear forwards; }
       @keyframes slide { from { left: 0; } to { left: 200px; } }
     </style></head><body><div id="box"></div></body></html>`,
    )}`;

    it("returns only after two consecutive identical bounding boxes — the animation has ended", async () => {
      const session = await launchPlaywrightSession({});
      try {
        await session.driver.goto(ANIMATED_FIXTURE);
        await session.driver.waitForElementStable("#box");
        const a = await session.driver.boundingBox("#box");
        await session.page.waitForTimeout(120);
        const b = await session.driver.boundingBox("#box");
        expect(a).toEqual(b); // stable — no longer animating
        expect(a!.x).toBe(200); // and at the animation's end state
      } finally {
        await session.close();
      }
    });
  },
  // 120s: a real-Chromium session's graceful shutdown can take ~30s on macOS
  // headless (GPU/sandbox-helper teardown), which alone exhausts a 30s budget.
  120_000,
);

describe.skipIf(!chromiumAvailable)(
  "PlaywrightDriver.screenshot — redactions",
  () => {
    it("a redaction selector matching nothing is skipped (screenshot still written, never a halt)", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-redact-"));
      const session = await launchPlaywrightSession({ docPackRoot: tmp });
      try {
        await session.driver.goto(CLOCK_FIXTURE);
        await session.driver.screenshot("docs/f/screenshots/s.png", [
          { selector: "#does-not-exist", style: "box" },
        ]);
        const stat = await fs.stat(path.join(tmp, "docs/f/screenshots/s.png"));
        expect(stat.size).toBeGreaterThan(0);
      } finally {
        await session.close();
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  },
  // 120s: a real-Chromium session's graceful shutdown can take ~30s on macOS
  // headless (GPU/sandbox-helper teardown), which alone exhausts a 30s budget.
  120_000,
);
