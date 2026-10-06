// Workspace confinement: the shared helper behind requireWorkspace and the other path arguments
// of the HTTP transport. Real directories and symlinks under a temp dir; no sockets.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireWorkspace, resolveToolPath, ToolInputError } from "../src/shared.js";
import {
  resolveInsideRoot,
  resolveWorkspaceRoot,
  WorkspaceRootError,
} from "../src/workspace-root.js";

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "docsxai-mcp-root-")));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  mkdirSync(path.join(root, "inner"), { recursive: true });
  mkdirSync(outside);
  // A link inside the root that leaves it, and one that stays inside.
  symlinkSync(outside, path.join(root, "escape"));
  symlinkSync(path.join(root, "inner"), path.join(root, "alias"));
  // A sibling whose name starts with the root's name.
  mkdirSync(`${root}-evil`);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveWorkspaceRoot", () => {
  it("returns the real path of an existing absolute directory", async () => {
    expect(await resolveWorkspaceRoot(root)).toBe(root);
    expect(await resolveWorkspaceRoot(path.join(root, "alias"))).toBe(path.join(root, "inner"));
  });

  it("refuses a missing, relative, empty or non-directory root", async () => {
    await expect(resolveWorkspaceRoot(undefined)).rejects.toThrow(/required/);
    await expect(resolveWorkspaceRoot("")).rejects.toThrow(/required/);
    await expect(resolveWorkspaceRoot("rel/dir")).rejects.toThrow(/absolute/);
    await expect(resolveWorkspaceRoot(path.join(base, "nope"))).rejects.toThrow(/existing/);
    const file = path.join(base, "a-file");
    writeFileSync(file, "x");
    await expect(resolveWorkspaceRoot(file)).rejects.toThrow(/existing directory/);
  });
});

describe("resolveInsideRoot", () => {
  it("accepts the root, paths under it and paths that do not exist yet", async () => {
    expect(await resolveInsideRoot(root, ".")).toBe(root);
    expect(await resolveInsideRoot(root, "inner")).toBe(path.join(root, "inner"));
    expect(await resolveInsideRoot(root, path.join(root, "new", "deeper"))).toBe(
      path.join(root, "new", "deeper"),
    );
    expect(await resolveInsideRoot(root, "inner/../fresh")).toBe(path.join(root, "fresh"));
  });

  it("follows a symlink that stays inside the root", async () => {
    expect(await resolveInsideRoot(root, "alias")).toBe(path.join(root, "inner"));
  });

  it("refuses .. and absolute paths that leave the root", async () => {
    for (const p of ["..", "../outside", "inner/../../outside", outside, base, "/", "/etc"]) {
      await expect(resolveInsideRoot(root, p), p).rejects.toThrow(WorkspaceRootError);
    }
  });

  it("refuses a sibling that shares the root's name as a prefix", async () => {
    await expect(resolveInsideRoot(root, `${root}-evil`)).rejects.toThrow(/outside/);
  });

  it("refuses a symlink that escapes, for the link itself and for paths beneath it", async () => {
    for (const p of ["escape", "escape/file", "escape/new/deeper", path.join(root, "escape")]) {
      await expect(resolveInsideRoot(root, p), p).rejects.toThrow(/outside/);
    }
  });

  it("refuses a path with a NUL byte", async () => {
    await expect(resolveInsideRoot(root, "bad\0name")).rejects.toThrow(WorkspaceRootError);
  });

  it("does not echo the offending path", async () => {
    const err = await resolveInsideRoot(root, outside).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(outside);
  });
});

describe("requireWorkspace and resolveToolPath", () => {
  it("falls back to the root when no workspace is given, if the root is a workspace", async () => {
    writeFileSync(path.join(root, ".docsxai.json"), "{}");
    expect(await requireWorkspace(undefined, { workspaceRoot: root })).toBe(root);
    rmSync(path.join(root, ".docsxai.json"));
  });

  it("confines an explicit workspace and reports it as a tool input error", async () => {
    const run = requireWorkspace(outside, { workspaceRoot: root });
    await expect(run).rejects.toThrow(ToolInputError);
    await expect(run).rejects.toThrow(/outside the server's workspace root/);
    await expect(requireWorkspace("escape", { workspaceRoot: root })).rejects.toThrow(/outside/);
  });

  it("resolves a relative workspace against the root, and a default workspace the same way", async () => {
    mkdirSync(path.join(root, "ws"), { recursive: true });
    writeFileSync(path.join(root, "ws", ".docsxai.json"), "{}");
    const ctx = { workspaceRoot: root };
    expect(await requireWorkspace("ws", ctx)).toBe(path.join(root, "ws"));
    expect(await requireWorkspace(undefined, { ...ctx, defaultWorkspace: "ws" })).toBe(
      path.join(root, "ws"),
    );
  });

  it("leaves stdio behaviour alone: no root means no confinement and no fallback", async () => {
    expect(await resolveToolPath(outside, {})).toBe(outside);
    await expect(requireWorkspace(undefined, {})).rejects.toThrow(/no workspace directory given/);
  });
});
