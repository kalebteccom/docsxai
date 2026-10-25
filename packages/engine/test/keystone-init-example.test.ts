// Keystone for the three-command first run: `init --example`, `run`, `render --open`, through the
// real CLI, real Chromium and the real viewer bin. A loopback server stands in for example.com
// (`run --base-url`), and the browser opener is stubbed, so the test needs no network and opens no
// window.
//
// Needs Chromium and a built viewer (`pnpm --filter @docsxai/viewer build`); skips without them.

import { existsSync, promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const opened: string[] = [];
vi.mock("../src/open-in-browser.js", () => ({
  openInBrowser: async (target: string) => {
    opened.push(target);
    return true;
  },
}));

const { main } = await import("../src/cli.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerBin = path.resolve(here, "../../viewer/dist/index.js");

let ready = false;
try {
  ready = existsSync(chromium.executablePath()) && existsSync(viewerBin);
} catch {
  ready = false;
}

describe.skipIf(!ready)("keystone: init --example, run, render --open", () => {
  let server: Server;
  let baseURL = "";
  let tmp = "";

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Example</title><h1>Example Domain</h1><p>Hello.</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-keystone-example-"));
  });

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("captures one annotated step and opens the viewer", async () => {
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    const errWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("DOCSX_VIEWER_BIN", viewerBin);
    try {
      const ws = path.join(tmp, "hello");
      expect(await main(["init", ws, "--example"])).toBe(0);
      expect(await main(["run", ws, "--base-url", baseURL])).toBe(0);
      expect(await main(["render", ws, "--open"])).toBe(0);

      const annotations = JSON.parse(
        await fs.readFile(path.join(ws, "docs", "hello", "annotations.json"), "utf8"),
      ) as { annotations: Array<{ step: string; copy: string }> };
      expect(annotations.annotations.map((a) => [a.step, a.copy])).toEqual([
        ["open-home", "This is the page title"],
      ]);
      expect(existsSync(path.join(ws, "docs", "hello", "screenshots", "open-home.png"))).toBe(true);
      const index = path.join(ws, ".viewer", "index.html");
      expect(existsSync(index)).toBe(true);
      expect(opened).toEqual([index]);
      expect(out.join("")).toContain("run: 1 of 1 flow ok");
    } finally {
      write.mockRestore();
      errWrite.mockRestore();
      vi.unstubAllEnvs();
    }
  }, 120_000);
});
