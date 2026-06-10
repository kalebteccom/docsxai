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
import { chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightDriver } from "../src/playwright-driver.js";

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
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-pwd-"));
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
  },
  30000,
);
