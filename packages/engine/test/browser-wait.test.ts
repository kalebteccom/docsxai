// `--pause` and `inspect --headed` wait for the operator to close the browser. A browser that is
// already gone must not leave the wait hanging, because `disconnected` fires only once.

import { promises as fs } from "node:fs";
import { EventEmitter } from "node:events";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowFile } from "../src/doc-pack.js";
import { waitForBrowserClose } from "../src/browser-wait.js";

const session = vi.hoisted(() => ({
  connected: false,
  close: null as null | (() => Promise<void>),
}));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: () => {
    const browser = Object.assign(new EventEmitter(), { isConnected: () => session.connected });
    return Promise.resolve({ driver: {}, browser, close: session.close });
  },
}));
vi.mock("../src/flow-runtime.js", () => ({
  runFlow: async () => ({
    steps: [],
    annotations: { schema: "docsxai/annotations@1", flow: "f", annotations: [] },
  }),
}));
const { runFlowsInSessions } = await import("../src/run-flows.js");

/** Fail after `ms` instead of hanging the suite. */
function within<T>(p: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("still waiting")), ms)),
  ]);
}

class FakeBrowser extends EventEmitter {
  constructor(private connected: boolean) {
    super();
  }
  isConnected(): boolean {
    return this.connected;
  }
  disconnect(): void {
    this.connected = false;
    this.emit("disconnected");
  }
}

describe("waitForBrowserClose", () => {
  it("resolves at once for a browser that is already disconnected", async () => {
    await within(waitForBrowserClose(new FakeBrowser(false)));
  });

  it("waits for the disconnected event while the browser is open", async () => {
    const browser = new FakeBrowser(true);
    let done = false;
    const wait = waitForBrowserClose(browser).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    browser.disconnect();
    await within(wait);
    expect(done).toBe(true);
  });
});

describe("run --pause with the browser already closed", () => {
  let ws = "";
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pause-"));
    await fs.writeFile(path.join(ws, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
    session.connected = false;
    session.close = vi.fn(async () => undefined);
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("finishes the run and closes the session instead of hanging", async () => {
    const result = await within(
      runFlowsInSessions({
        projectDir: ws,
        outputRoot: ws,
        flows: [{ name: "f", steps: [], locators: {} } as unknown as FlowFile],
        headed: true,
        ignoreHTTPSErrors: false,
        pause: true,
        obstacles: false,
        concurrency: 1,
        progress: () => undefined,
      }),
    );
    expect(result.okCount).toBe(1);
    expect(session.close).toHaveBeenCalledOnce();
  });
});
