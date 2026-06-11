import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveWorkspacePath,
  resolveWorkspacePathReal,
  WorkspacePathEscapeError,
} from "../src/workspace.js";

let tmp = "";
beforeEach(async () => {
  // realpath up front — macOS tmpdir is itself a symlink (/var → /private/var)
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-wsp-test-")));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("resolveWorkspacePath", () => {
  it("joins plain segments under the workspace root", () => {
    expect(resolveWorkspacePath(tmp, "flows")).toBe(path.join(tmp, "flows"));
  });

  it("joins nested segments", () => {
    expect(resolveWorkspacePath(tmp, "docs", "my-flow", "screenshots", "step-1.png")).toBe(
      path.join(tmp, "docs", "my-flow", "screenshots", "step-1.png"),
    );
  });

  it("returns the root itself for zero segments", () => {
    expect(resolveWorkspacePath(tmp)).toBe(tmp);
  });

  it("rejects `..` traversal out of the workspace", () => {
    expect(() => resolveWorkspacePath(tmp, "..", "outside.txt")).toThrow(WorkspacePathEscapeError);
    expect(() => resolveWorkspacePath(tmp, "docs", "..", "..", "outside.txt")).toThrow(
      WorkspacePathEscapeError,
    );
  });

  it("allows `..` that stays inside the workspace", () => {
    expect(resolveWorkspacePath(tmp, "docs", "..", "flows")).toBe(path.join(tmp, "flows"));
  });

  it("rejects a sibling directory that shares the root as a string prefix", () => {
    const root = path.join(tmp, "docs");
    expect(() => resolveWorkspacePath(root, "..", "docs-evil")).toThrow(WorkspacePathEscapeError);
  });

  it("rejects an absolute segment that escapes the workspace", () => {
    expect(() => resolveWorkspacePath(tmp, "/etc/passwd")).toThrow(WorkspacePathEscapeError);
    expect(() => resolveWorkspacePath(tmp, path.join(os.tmpdir(), "elsewhere"))).toThrow(
      WorkspacePathEscapeError,
    );
  });
});

describe("resolveWorkspacePathReal", () => {
  it("resolves paths whose parents don't exist yet", async () => {
    await expect(
      resolveWorkspacePathReal(tmp, "docs", "new-flow", "annotations.json"),
    ).resolves.toBe(path.join(tmp, "docs", "new-flow", "annotations.json"));
  });

  it("rejects a symlink inside the workspace pointing outside", async () => {
    const outside = path.join(tmp, "outside");
    const ws = path.join(tmp, "ws");
    await fs.mkdir(outside, { recursive: true });
    await fs.mkdir(ws, { recursive: true });
    await fs.symlink(outside, path.join(ws, "escape"));
    await expect(resolveWorkspacePathReal(ws, "escape", "halt.png")).rejects.toThrow(
      WorkspacePathEscapeError,
    );
  });

  it("allows a symlink that stays inside the workspace", async () => {
    const ws = path.join(tmp, "ws2");
    await fs.mkdir(path.join(ws, "docs"), { recursive: true });
    await fs.symlink(path.join(ws, "docs"), path.join(ws, "docs-link"));
    await expect(resolveWorkspacePathReal(ws, "docs-link", "x.png")).resolves.toBe(
      path.join(ws, "docs-link", "x.png"),
    );
  });

  it("rejects lexical `..` traversal like the sync variant", async () => {
    await expect(resolveWorkspacePathReal(tmp, "..", "outside.txt")).rejects.toThrow(
      WorkspacePathEscapeError,
    );
  });
});
