// Keystone for `wait_for: settled`: real Chromium, a loopback server that answers a web font and an
// image late, the real runtime and driver.
//
// Claims: after a click that starts a late font swap and a late image, `settled` returns only once
// both have arrived and the content below has moved to its final place, where a bare `load` wait
// returns while the page is still on the fallback layout; a page whose layout never stops moving
// and a page with an image that never answers each halt within their step budget, with the settle
// message and the halt cause.
//
// Needs Chromium (see keystone.test.ts); skips without it.

import { existsSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlowFile } from "../src/flow-file.js";
import { FlowExecutionError, runFlow } from "../src/flow-runtime.js";
import { launchPlaywrightSession, type PlaywrightSession } from "../src/playwright-driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const toySite = path.join(here, "fixtures", "toy-site");
const fontFile = path.resolve(here, "../../viewer/assets/fonts/inter-regular.ttf");

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath()) && existsSync(fontFile);
} catch {
  chromiumAvailable = false;
}

const FONT_DELAY_MS = 600;
const IMAGE_DELAY_MS = 800;
const IMAGE_HEIGHT = 120;

describe.skipIf(!chromiumAvailable)("keystone — wait_for: settled", () => {
  let server: Server;
  let baseURL = "";
  let tmp = "";
  let session: PlaywrightSession;
  /** Resources the server has finished sending. */
  const served = new Set<string>();

  const later = (ms: number, send: () => void) => setTimeout(send, ms);

  beforeAll(async () => {
    const font = await fs.readFile(fontFile);
    const png = new PNG({ width: 300, height: IMAGE_HEIGHT });
    png.data.fill(200);
    const image = PNG.sync.write(png);
    server = createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0]!;
      if (url === "/late-font.ttf") {
        later(FONT_DELAY_MS, () => {
          res.writeHead(200, { "content-type": "font/ttf" });
          res.end(font, () => served.add("font"));
        });
      } else if (url === "/late-image.png") {
        later(IMAGE_DELAY_MS, () => {
          res.writeHead(200, { "content-type": "image/png" });
          res.end(image, () => served.add("image"));
        });
      } else if (url === "/never-answered.png") {
        // Left open on purpose: closed with the server.
      } else if (/^\/[a-z-]+\.html$/.test(url)) {
        fs.readFile(path.join(toySite, url.slice(1))).then(
          (html) => {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(html);
          },
          () => {
            res.writeHead(404).end();
          },
        );
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-settled-"));
    session = await launchPlaywrightSession({
      baseURL,
      docPackRoot: tmp,
      environment: { viewport: { width: 800, height: 600 } },
    });
  }, 120_000);

  afterAll(async () => {
    await session?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await fs.rm(tmp, { recursive: true, force: true });
    // 120s hook budget: the browser's graceful shutdown can take ~30s on macOS headless.
  }, 120_000);

  const box = async (selector: string) => {
    const b = await session.driver.boundingBox(selector, 2000);
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
  };
  const startSwap = async () => {
    served.clear();
    await session.driver.goto(`${baseURL}settle.html`);
    await session.driver.waitForLoad();
    await session.driver.click("#swap");
  };

  it("a bare load wait returns on the fallback layout, so the late loads are real", async () => {
    await startSwap();
    const early = await box("#after");
    expect(served.size).toBe(0);
    await session.driver.waitForSettled!(5000);
    const final = await box("#after");
    expect(early.y + IMAGE_HEIGHT).toBeCloseTo(final.y, 0);
  });

  it("settled returns after the font and the image arrived, with the layout at rest", async () => {
    await startSwap();
    const titleBefore = await box("#title");
    const started = Date.now();
    await session.driver.waitForSettled!(5000);
    const elapsed = Date.now() - started;

    expect([...served].sort()).toEqual(["font", "image"]);
    expect(elapsed).toBeGreaterThanOrEqual(IMAGE_DELAY_MS - 200);
    expect(elapsed).toBeLessThan(4000);

    const title = await box("#title");
    const after = await box("#after");
    expect(title.width).not.toBeCloseTo(titleBefore.width, 0); // the web font replaced the fallback
    expect(after.y).toBeGreaterThanOrEqual(IMAGE_HEIGHT);

    // Nothing moves afterwards: the page was at rest when `settled` returned.
    await session.driver.waitForTimeout(1200);
    expect(await box("#title")).toEqual(title);
    expect(await box("#after")).toEqual(after);
  });

  it("runs as a flow step: the annotation box of the content below is its final box", async () => {
    const flow = parseFlowFile(`
name: settle
environment:
  viewport: { width: 800, height: 600 }
locators: { swap: "#swap", after: "#after" }
steps:
  - id: open
    action: navigate
    value: settle.html
    wait_for: load
  - id: swap
    action: click
    target: $swap
    wait_for: settled
    timeout_ms: 5000
  - id: shot
    action: wait
    target: $after
    annotation: { copy: "Below the image" }
`);
    served.clear();
    const result = await runFlow(flow, session.driver);
    expect([...served].sort()).toEqual(["font", "image"]);
    const annotated = result.annotations.annotations.find((a) => a.step === "shot")!.bounding_box;
    await session.driver.waitForTimeout(1000);
    expect(annotated).toEqual(await box("#after"));
    expect(annotated.y).toBeGreaterThanOrEqual(IMAGE_HEIGHT);
  });

  it("halts within the step budget on a page whose layout never stops moving", async () => {
    const flow = parseFlowFile(`
name: moving
environment:
  viewport: { width: 800, height: 600 }
steps:
  - id: open
    action: navigate
    value: never-settles.html
    wait_for: load
  - id: ready
    action: wait
    wait_for: settled
    timeout_ms: 600
`);
    const started = Date.now();
    const err = await runFlow(flow, session.driver, { captureDocs: false }).catch((e) => e);
    expect(err).toBeInstanceOf(FlowExecutionError);
    expect(err.stepId).toBe("ready");
    expect(err.message).toMatch(/^\[page never settled: /);
    expect(err.message).toMatch(
      /settled: page did not settle within 600 ms after \d+ poll\(s\): layout of the visible elements still changing/,
    );
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("halts naming the image on a page with an image that never answers", async () => {
    const flow = parseFlowFile(`
name: hung
environment:
  viewport: { width: 800, height: 600 }
steps:
  - id: open
    action: navigate
    value: hung-image.html
    wait_for: load
  - id: ready
    action: wait
    wait_for: settled
    timeout_ms: 500
`);
    const err = await runFlow(flow, session.driver, { captureDocs: false }).catch((e) => e);
    expect(err).toBeInstanceOf(FlowExecutionError);
    expect(err.message).toMatch(/^\[page never settled: /);
    expect(err.message).toContain("1 visible image(s) still loading");
  });
});
