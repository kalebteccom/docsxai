// Commands that attach to a running Chrome over --cdp must drop the connection when they finish,
// whether or not --headed is also given (it means nothing for an attach).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ closes: 0, launches: [] as unknown[] }));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: async (opts: unknown) => {
    session.launches.push(opts);
    return {
      browser: { isConnected: () => true, on: () => undefined, off: () => undefined },
      page: {
        url: () => "https://app.test/",
        title: async () => "App",
        goto: async () => undefined,
        waitForTimeout: async () => undefined,
        $$eval: async () => [],
      },
      close: async () => {
        session.closes++;
      },
    };
  },
}));
const { main } = await import("../src/cli.js");

let ws = "";
beforeEach(async () => {
  session.closes = 0;
  session.launches = [];
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-cdp-release-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

describe("inspect --cdp", () => {
  it.each([[[]], [["--headed"]]])("drops the connection when it finishes (%j)", async (extra) => {
    const argv = ["inspect", ws, "--cdp", "http://localhost:9222", "--wait", "0", ...extra];
    expect(await main(argv)).toBe(0);
    expect(session.launches).toHaveLength(1);
    expect(session.closes).toBe(1);
  });
});
