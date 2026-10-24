// `inspect` used to print a warning for a page that failed to load, then list an empty page and
// exit 0. The launcher is stubbed with a page whose goto rejects, so no browser starts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ closed: 0 }));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: () =>
    Promise.resolve({
      browser: {},
      close: () => {
        stub.closed += 1;
        return Promise.resolve();
      },
      page: {
        goto: () =>
          Promise.reject(
            new Error(
              "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/\nCall log:",
            ),
          ),
        url: () => "chrome-error://chromewebdata/",
        title: () => Promise.resolve(""),
        waitForTimeout: () => Promise.resolve(),
        $$eval: () => Promise.resolve([]),
      },
    }),
}));
const { main } = await import("../src/cli.js");

let out = "";
let err = "";
let tmp = "";
beforeEach(async () => {
  out = "";
  err = "";
  stub.closed = 0;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-inspect-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("inspect when the page does not load", () => {
  it("exits 1 and names the URL and the next step", async () => {
    const ws = path.join(tmp, "ws");
    expect(await main(["init", ws, "--app-url", "http://localhost:3000", "--auth", "none"])).toBe(
      0,
    );
    out = "";
    err = "";
    expect(await main(["inspect", ws])).toBe(1);
    expect(err).toContain("inspect: could not load http://localhost:3000");
    expect(err).toContain("next: start the app, then docsxai inspect");
    expect(out).not.toContain("chrome-error");
    expect(stub.closed).toBe(1);
  });
});
