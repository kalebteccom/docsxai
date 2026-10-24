// A SIGTERM or SIGINT sent to `docsxai` reaches the viewer child (render, burn, pack) and the
// command waits for it, so the child is not left writing after the parent is gone.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAsBin } from "../src/cli-unexpected.js";
import { forwardSignalToViewer, runViewerBin, VIEWER_BIN_ENV } from "../src/viewer-bin.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-signal-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A viewer stand-in that writes `ready` once it listens, then idles until a signal ends it. */
async function stubViewer(onTerm: string): Promise<string> {
  const script = path.join(tmp, "viewer-stub.js");
  await fs.writeFile(
    script,
    `${onTerm}\nrequire("node:fs").writeFileSync(${JSON.stringify(path.join(tmp, "ready"))}, "1");\nsetInterval(() => {}, 1000);\n`,
    "utf8",
  );
  vi.stubEnv(VIEWER_BIN_ENV, script);
  return script;
}

async function untilReady(): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (
      await fs.access(path.join(tmp, "ready")).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("the viewer stand-in never became ready");
}

describe("forwardSignalToViewer", () => {
  it("returns false when no viewer child is running", () => {
    expect(forwardSignalToViewer("SIGTERM")).toBe(false);
  });

  it("passes the signal to the child and runViewerBin returns the child's exit code", async () => {
    await stubViewer('process.on("SIGTERM", () => process.exit(7));');
    const run = runViewerBin("burn", []);
    await untilReady();
    expect(forwardSignalToViewer("SIGTERM")).toBe(true);
    expect(await run).toBe(7);
    expect(forwardSignalToViewer("SIGTERM")).toBe(false);
  });

  it("returns 128 plus the signal number when the signal ends the child", async () => {
    await stubViewer("");
    const run = runViewerBin("burn", []);
    await untilReady();
    expect(forwardSignalToViewer("SIGTERM")).toBe(true);
    expect(await run).toBe(143);
  });
});

describe("runAsBin with a viewer child", () => {
  it("forwards SIGTERM to the child and waits for it instead of exiting at once", async () => {
    await stubViewer('process.on("SIGTERM", () => setTimeout(() => process.exit(9), 50));');
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runAsBin(async () => {
      const run = runViewerBin("burn", []);
      await untilReady();
      // The listener runAsBin registered last is its own.
      process.listeners("SIGTERM").at(-1)!("SIGTERM");
      return run;
    }, []);
    expect(exit).not.toHaveBeenCalled();
    expect(code).toBe(9);
  });
});

describe("runAsBin after a signal reached a viewer child", () => {
  /** Send `signal` to the handler runAsBin registered last (its own) once the child is ready. */
  async function interrupt(signal: "SIGINT" | "SIGTERM", times = 1): Promise<void> {
    await untilReady();
    for (let i = 0; i < times; i++) process.listeners(signal).at(-1)!(signal);
  }

  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("exits 143, not 0, when the child shut down cleanly on SIGTERM", async () => {
    await stubViewer('process.on("SIGTERM", () => process.exit(0));');
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const code = await runAsBin(async () => {
      const run = runViewerBin("burn", []);
      await interrupt("SIGTERM");
      return run;
    }, []);
    expect(code).toBe(143);
  });

  it("exits 130 for SIGINT when the child shut down cleanly", async () => {
    await stubViewer('process.on("SIGINT", () => process.exit(0));');
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const code = await runAsBin(async () => {
      const run = runViewerBin("burn", []);
      await interrupt("SIGINT");
      return run;
    }, []);
    expect(code).toBe(130);
  });

  it("kills a child that ignores the signal once the grace period ends", async () => {
    await stubViewer('process.on("SIGTERM", () => {});');
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const code = await runAsBin(
      async () => {
        const run = runViewerBin("burn", []);
        await interrupt("SIGTERM");
        return run;
      },
      [],
      process.env,
      { killAfterMs: 100 },
    );
    expect(code).toBe(137);
  });

  it("a second signal ends the process at once with the signal's code and kills the child", async () => {
    await stubViewer('process.on("SIGINT", () => {});');
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const code = await runAsBin(
      async () => {
        const run = runViewerBin("burn", []);
        await interrupt("SIGINT", 2);
        return run;
      },
      [],
      process.env,
      { killAfterMs: 60_000 },
    );
    expect(exit).toHaveBeenCalledWith(130);
    expect(code).toBe(137);
  });
});
