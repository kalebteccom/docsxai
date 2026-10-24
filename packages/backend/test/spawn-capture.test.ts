import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { spawnCapture, type SpawnLike } from "../src/strategy.js";

/** A spawn stand-in that emits `chunks` on stdout, then closes with `code`. */
function fakeSpawn(chunks: string[], code = 0): SpawnLike {
  return () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    setImmediate(() => {
      for (const c of chunks) child.stdout.emit("data", Buffer.from(c));
      child.emit("close", code);
    });
    return child as unknown as ReturnType<SpawnLike>;
  };
}

describe("spawnCapture", () => {
  it("returns the exit code and the output of a short run", async () => {
    const r = await spawnCapture(fakeSpawn(["a\n", "b\n"], 3), "engine", []);
    expect(r).toEqual({ code: 3, output: "a\nb\n" });
  });

  it("keeps the end of the output when it exceeds the cap, so the last line survives", async () => {
    const noisy = "x".repeat(70 * 1024) + "\n";
    const r = await spawnCapture(fakeSpawn([noisy, "documented 3 flows\n"]), "engine", []);
    expect(r.output.trim().split("\n").pop()).toBe("documented 3 flows");
    expect(r.output.length).toBeLessThanOrEqual(64 * 1024);
  });
});
