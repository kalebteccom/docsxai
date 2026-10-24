// A browser that cannot start is the first failure most operators meet. `run`, `inspect` and
// `capture-auth` each name the cause, the flag involved and the one command to run next, and none
// of them prints Playwright's own banner or call log. The launcher is stubbed with the exact
// messages Playwright throws, so no browser starts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MISSING =
  "browserType.launchPersistentContext: Executable doesn't exist at /home/u/.cache/ms-playwright/chromium-1/chrome\n" +
  "╔════════════════════════════════════════════════════════════╗\n" +
  "║ Looks like Playwright was just installed or updated.       ║\n" +
  "║     npx playwright install                                 ║\n" +
  "╚════════════════════════════════════════════════════════════╝";
const REFUSED =
  "browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:9222\nCall log:\n  - <ws preparing> retrieving websocket url from http://127.0.0.1:9222\n";

const launch = vi.hoisted(() => ({ message: "" }));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: () => Promise.reject(new Error(launch.message)),
}));
vi.mock("../src/auth.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth.js")>()),
  makeStrategy: () => ({ authenticate: () => Promise.reject(new Error(launch.message)) }),
}));
const { main } = await import("../src/cli.js");

let err = "";
let tmp = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-launch-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const ws = path.join(tmp, "ws");
  expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1"])).toBe(0);
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nlocators: { b: '#b' }\nsteps:\n  - id: s\n    action: hover\n    target: $b\n    success: { visible: $b }\n",
  );
  err = "";
  return ws;
}

const INSTALL = "npx playwright-core install chromium";

describe("no Chromium binary", () => {
  beforeEach(() => void (launch.message = MISSING));

  it.each(["inspect", "capture-auth"])(
    "%s names the missing binary and the install command",
    async (cmd) => {
      const ws = await workspace();
      expect(
        await main([cmd, ws, ...(cmd === "inspect" ? ["--url", "http://127.0.0.1:1"] : [])]),
      ).toBe(1);
      expect(err).toContain(`${cmd}: no Chromium binary found`);
      expect(err).toContain(`next: ${INSTALL}`);
      expect(err).not.toContain("Playwright Team");
      expect(err).not.toContain("╔");
    },
  );

  it("run names the missing binary and points at doctor", async () => {
    const ws = await workspace();
    await fs.rm(path.join(ws, "auth", "strategy.yaml"));
    expect(await main(["run", ws])).toBe(1);
    expect(err).toContain("run: no Chromium binary found");
    expect(err).toContain(`next: ${INSTALL}`);
  });
});

describe("--cdp endpoint that refuses the connection", () => {
  beforeEach(() => void (launch.message = REFUSED));
  const endpoint = "http://127.0.0.1:9222";
  const next = "next: start Chrome with --remote-debugging-port=9222, then rerun the command";

  it.each(["run", "inspect", "capture-auth"])(
    "%s names the endpoint and how to start it",
    async (cmd) => {
      const ws = await workspace();
      expect(await main([cmd, ws, "--cdp", endpoint])).toBe(1);
      expect(err).toContain(`${cmd}: cannot attach to the browser at ${endpoint} (ECONNREFUSED)`);
      expect(err).toContain("--cdp");
      expect(err).toContain(next);
      expect(err).not.toContain("Call log");
    },
  );
});
