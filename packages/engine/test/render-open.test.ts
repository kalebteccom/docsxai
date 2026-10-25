// `docsxai render --open`: after a good build it hands `.viewer/index.html` to the opener; when the
// opener can't show it, render says so and still exits 0. Without --open nothing is opened.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opened: string[] = [];
let openResult = true;
vi.mock("../src/open-in-browser.js", () => ({
  openInBrowser: async (target: string) => {
    opened.push(target);
    return openResult;
  },
}));

const { main } = await import("../src/cli.js");

let out = "";
let err = "";
let tmp = "";
beforeEach(async () => {
  out = "";
  err = "";
  opened.length = 0;
  openResult = true;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-render-open-"));
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
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function workspaceWithViewer(exitCode = 0): Promise<string> {
  const ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "docs"), { recursive: true });
  const script = path.join(tmp, "fake-viewer.js");
  await fs.writeFile(script, `process.exit(${exitCode});\n`, "utf8");
  vi.stubEnv("DOCSX_VIEWER_BIN", script);
  return ws;
}

describe("render --open", () => {
  it("opens the index after a good build and keeps the open line", async () => {
    const ws = await workspaceWithViewer();
    expect(await main(["render", ws, "--open"])).toBe(0);
    const index = path.join(ws, ".viewer", "index.html");
    expect(opened).toEqual([index]);
    expect(out).toContain(`render: open ${index}`);
    expect(out).toContain("render: opened it in your browser\n");
    expect(err).toBe("");
  });

  it("says so and exits 0 when no browser can be opened", async () => {
    const ws = await workspaceWithViewer();
    openResult = false;
    expect(await main(["render", ws, "--open"])).toBe(0);
    expect(err).toBe(
      `render: couldn't open a browser here, open ${path.join(ws, ".viewer", "index.html")} yourself\n`,
    );
  });

  it("opens nothing when the build fails", async () => {
    const ws = await workspaceWithViewer(3);
    expect(await main(["render", ws, "--open"])).toBe(3);
    expect(opened).toEqual([]);
  });

  it("opens nothing without --open, and prints what it printed before", async () => {
    const ws = await workspaceWithViewer();
    expect(await main(["render", ws])).toBe(0);
    expect(opened).toEqual([]);
    expect(out).toBe(
      `render: open ${path.join(ws, ".viewer", "index.html")}  (the index links the flows; each flow page shows the screenshots, hover a pulsing halo to read its callout)\n`,
    );
  });

  it("rejects a value on --open", async () => {
    const ws = await workspaceWithViewer();
    expect(await main(["render", ws, "--open=yes"])).toBe(2);
    expect(opened).toEqual([]);
  });
});
