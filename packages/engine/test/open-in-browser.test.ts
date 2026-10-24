// The opener behind `docsxai render --open`: one argv array per platform, no shell, and a quiet
// `false` when the platform can't show a browser or the opener isn't installed.

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { browserOpener, openInBrowser, type SpawnLike } from "../src/open-in-browser.js";

const target = "/tmp/my ws/.viewer/index.html";

describe("browserOpener", () => {
  it("uses open on macOS", () => {
    expect(browserOpener(target, "darwin", {})).toEqual({ command: "open", args: [target] });
  });

  it("uses explorer.exe on Windows, so no shell parses the path", () => {
    expect(browserOpener(target, "win32", {})).toEqual({
      command: "explorer.exe",
      args: [target],
    });
  });

  it("uses xdg-open on Linux with a display", () => {
    const opener = { command: "xdg-open", args: [target] };
    expect(browserOpener(target, "linux", { DISPLAY: ":0" })).toEqual(opener);
    expect(browserOpener(target, "linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual(opener);
  });

  it("gives up on Linux without a display", () => {
    expect(browserOpener(target, "linux", {})).toBeUndefined();
  });
});

/** A spawn that records its call and then emits `event` on the child. */
function fakeSpawn(event: "spawn" | "error"): { spawn: SpawnLike; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const spawn: SpawnLike = (command, args, options) => {
    calls.push([command, args, options]);
    const child = Object.assign(new EventEmitter(), { unref: () => undefined });
    queueMicrotask(() =>
      event === "spawn" ? child.emit("spawn") : child.emit("error", new Error("ENOENT")),
    );
    return child;
  };
  return { spawn, calls };
}

describe("openInBrowser", () => {
  it("spawns the opener detached with ignored stdio and resolves true", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    expect(await openInBrowser(target, { platform: "darwin", env: {}, spawn })).toBe(true);
    expect(calls).toEqual([["open", [target], { stdio: "ignore", detached: true }]]);
  });

  it("resolves false when the opener is not installed", async () => {
    const { spawn } = fakeSpawn("error");
    expect(await openInBrowser(target, { platform: "linux", env: { DISPLAY: ":0" }, spawn })).toBe(
      false,
    );
  });

  it("resolves false without spawning when there is no display", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    expect(await openInBrowser(target, { platform: "linux", env: {}, spawn })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("resolves false when spawn throws", async () => {
    const spawn: SpawnLike = () => {
      throw new Error("EPERM");
    };
    expect(await openInBrowser(target, { platform: "darwin", env: {}, spawn })).toBe(false);
  });
});
