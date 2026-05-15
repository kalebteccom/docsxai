// Actionability predicate — exercise `PlaywrightDriver.actionable(selector)` against a live
// browser on controlled HTML, covering each ActionableState. Chromium-gated (skips when no
// browser binary is installed) like the keystone.

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { launchPlaywrightSession } from "../src/playwright-driver.js";

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const FIXTURE_HTML = `
<!doctype html><html><head><meta charset="utf-8"><title>actionable fixture</title>
<style>
  body { font-family: system-ui; padding: 2rem; margin: 0 }
  .hidden { display: none }
  .scroll { width: 200px; height: 100px; overflow: auto; border: 1px solid #ccc }
  .far { margin-top: 5000px }
  .stack { position: relative; width: 200px; height: 60px }
  .stack .below { position: absolute; inset: 0; background: #4a90e2; color: white; display: flex; align-items: center; justify-content: center }
  .stack .overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5) }
</style></head>
<body>
  <button id="ready">Ready</button>
  <button id="disabled-btn" disabled>Disabled</button>
  <button class="hidden" id="hidden-btn">Hidden</button>
  <div class="stack"><button id="under">Under the overlay</button><div class="overlay"></div></div>
  <button class="dup">Dup A</button>
  <button class="dup">Dup B</button>
  <div class="scroll"><div style="height:1000px"><button id="below-fold">Below the scroller's fold</button></div></div>
  <button id="far" class="far">Far off-screen</button>
</body></html>
`;

describe.skipIf(!chromiumAvailable)("PlaywrightDriver.actionable", () => {
  it("returns one state per ActionableState: actionable / disabled / not-visible / off-screen / covered / multiple-matches / not-found", async () => {
    const session = await launchPlaywrightSession({ docPackRoot: "/tmp" });
    try {
      await session.page.setContent(FIXTURE_HTML);
      const d = session.driver;
      expect(await d.actionable("#ready")).toBe("actionable");
      expect(await d.actionable("#disabled-btn")).toBe("disabled");
      expect(await d.actionable("#hidden-btn")).toBe("not-visible");
      expect(await d.actionable("#far")).toBe("off-screen");
      expect(await d.actionable("#under")).toBe("covered");
      expect(await d.actionable(".dup")).toBe("multiple-matches");
      expect(await d.actionable("#nope")).toBe("not-found");
      // Note: an element inside a scroll container whose CONTENT is below the scroller's fold
      // (e.g. `#below-fold`) returns "actionable" — Playwright auto-scrolls to it before any
      // action, so "off-screen" only fires for elements outside the viewport with no scroll path.
    } finally {
      await session.close();
    }
  }, 30000);
});
