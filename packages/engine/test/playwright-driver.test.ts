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
    });

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
  30000,
);

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
  30000,
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
  30000,
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
  30000,
);
