// An error no command handled: one line and a DOCSX_DEBUG hint by default, the stack with it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  debugEnabled,
  interruptedText,
  runAsBin,
  unexpectedErrorText,
} from "../src/cli-unexpected.js";
import { runAsBin as fromCli } from "../src/cli.js";

let err = "";

beforeEach(() => {
  err = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function bug(): Error {
  const e = new Error("cannot read properties of undefined\nsecond line");
  e.stack = "Error: cannot read properties of undefined\n    at frame (file.js:1:1)";
  return e;
}

describe("debugEnabled", () => {
  it("reads 1, true and yes in any case", () => {
    for (const v of ["1", "true", "YES"]) expect(debugEnabled({ DOCSX_DEBUG: v })).toBe(true);
    for (const v of ["", "0", "no", "debug"]) expect(debugEnabled({ DOCSX_DEBUG: v })).toBe(false);
    expect(debugEnabled({})).toBe(false);
  });
});

describe("unexpectedErrorText", () => {
  it("prints the first line and the DOCSX_DEBUG hint, without a stack", () => {
    const text = unexpectedErrorText(bug(), false);
    expect(text).toBe(
      "docsxai: unexpected error: cannot read properties of undefined\n" +
        "  next: rerun with DOCSX_DEBUG=1 for the stack trace, and report it at https://github.com/kalebteccom/docsxai/issues\n",
    );
    expect(text).not.toContain("at frame");
  });

  it("prints the stack when debug is on", () => {
    const text = unexpectedErrorText(bug(), true);
    expect(text).toContain("at frame (file.js:1:1)");
    expect(text).toMatch(/\n {2}next: report it at /);
  });

  it("redacts URLs in the message and the stack", () => {
    const leaky = "https://ops" + ":s3cret@h.example/x?token=abc";
    const e = new Error(`fetch ${leaky} failed`);
    for (const debug of [false, true]) {
      const text = unexpectedErrorText(e, debug);
      expect(text).toContain("fetch https://h.example/x failed");
      expect(text).not.toContain("s3cret");
      expect(text).not.toContain("token=abc");
    }
  });

  it("says what to fix for a file the disk refused, without the report-a-bug line", () => {
    const e = Object.assign(new Error("EACCES: permission denied, mkdir '/ro/docs'"), {
      code: "EACCES",
      path: "/ro/docs",
    });
    const text = unexpectedErrorText(e, false);
    expect(text).toBe(
      "docsxai: cannot access /ro/docs (EACCES, permission denied)\n" +
        "  next: chmod -R u+rw /ro/docs  (or pick another directory), then rerun the command\n",
    );
    expect(unexpectedErrorText(e, true)).toContain("unexpected error");
  });

  it("handles a thrown value that is not an Error", () => {
    expect(unexpectedErrorText("boom", false)).toMatch(/^docsxai: unexpected error: boom\n/);
  });
});

describe("interruptedText", () => {
  it("names the signal and the command to start over, quoted", () => {
    expect(interruptedText("SIGINT", ["run", "/my ws", "--flow", "tour"])).toBe(
      "docsxai: interrupted (SIGINT); anything a finished step wrote stays on disk\n" +
        "  next: docsxai run '/my ws' --flow tour  (the same command starts over)\n",
    );
  });
});

describe("runAsBin", () => {
  it("leaves no signal listener behind", async () => {
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    let during: number[] = [];
    await runAsBin(
      () => {
        during = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
        return Promise.resolve(0);
      },
      [],
      {},
    );
    expect(during).toEqual(before.map((n) => n + 1));
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });

  it("passes the exit code of main through", async () => {
    expect(await runAsBin(() => Promise.resolve(2), [])).toBe(2);
    expect(err).toBe("");
  });

  it("turns a thrown error into exit 1 and one line on stderr", async () => {
    const code = await runAsBin(() => Promise.reject(bug()), [], {});
    expect(code).toBe(1);
    expect(err).toContain("docsxai: unexpected error: cannot read properties of undefined");
    expect(err).not.toContain("at frame");
  });

  it("prints the stack with DOCSX_DEBUG=1", async () => {
    await runAsBin(() => Promise.reject(bug()), [], { DOCSX_DEBUG: "1" });
    expect(err).toContain("at frame (file.js:1:1)");
  });

  it("is exported from the CLI entry the meta-package bin imports", () => {
    expect(fromCli).toBe(runAsBin);
  });
});
