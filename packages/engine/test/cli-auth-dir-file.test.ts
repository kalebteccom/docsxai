// A `.auth` that is a file (a stray `touch .auth`, a bad checkout) used to surface as Playwright's
// raw ENOTDIR from `capture-auth`, and as "no valid cached session" from every command that reads
// sessions. Each now names the file, says it is a file where a directory is needed, and gives one
// `next:` line. The launcher is stubbed so no browser starts.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => ({ message: "" }));
vi.mock("../src/playwright-driver.js", () => ({
  launchPlaywrightSession: () => Promise.reject(new Error(launch.message)),
}));
vi.mock("../src/auth.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth.js")>()),
  makeStrategy: () => ({ authenticate: () => Promise.reject(new Error(launch.message)) }),
}));
const { main } = await import("../src/cli.js");
const { describeFsError } = await import("../src/cli-messages.js");

let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-authfile-"));
  ws = path.join(tmp, "ws");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1"])).toBe(0);
  await fs.writeFile(
    path.join(ws, "flows", "f.flow.yaml"),
    "name: f\nlocators: { b: '#b' }\nsteps:\n  - id: s\n    action: hover\n    target: $b\n    success: { visible: $b }\n",
  );
  await fs.rm(path.join(ws, ".auth"), { recursive: true });
  await fs.writeFile(path.join(ws, ".auth"), "not a directory");
  launch.message = `browserType.launchPersistentContext: ENOTDIR: not a directory, mkdir '${path.join(ws, ".auth", "chrome-profile")}'`;
  err = "";
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const file = () => path.join(ws, ".auth");

function expectNamed(label: string): void {
  expect(err).toContain(`${label}: ${file()} is a file, but docsxai needs a directory there`);
  expect(err).toContain("ENOTDIR");
  expect(err).toContain(`next: mv ${file()} ${file()}.bak, then rerun the command`);
  expect(err).not.toContain("not a directory, mkdir");
  expect(err).not.toContain("no valid cached session");
}

describe(".auth is a file", () => {
  it("capture-auth names the file and the move", async () => {
    expect(await main(["capture-auth", ws])).toBe(1);
    expectNamed("capture-auth");
  });

  it("run names the file and the move", async () => {
    expect(await main(["run", ws])).toBe(1);
    expectNamed("run");
  });

  it("inspect names the file and the move", async () => {
    expect(await main(["inspect", ws, "--url", "http://127.0.0.1:1"])).toBe(1);
    expectNamed("inspect");
  });

  it("describeFsError names the blocking file for a path below it", () => {
    const e = Object.assign(new Error("ENOTDIR"), {
      code: "ENOTDIR",
      path: path.join(ws, ".auth", "editor.json"),
    });
    const text = describeFsError(e) ?? "";
    expect(text).toContain(`${file()} is a file, but docsxai needs a directory there`);
    expect(text).toContain(`next: mv ${file()} ${file()}.bak`);
  });
});
