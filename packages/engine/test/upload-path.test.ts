// `upload` steps read only from under the workspace: the spelling rule is pure, and
// `resolveUploadPath` follows symlinks on a real temp directory before it lets a path through.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveUploadPath, uploadPathProblem, UploadPathError } from "../src/upload-path.js";

describe("uploadPathProblem", () => {
  it.each([
    "a.png",
    "uploads/a.png",
    "./a.png",
    "a/b/c.txt",
    "a..b",
    "a/b..c/d",
    "webhook-job.json.bak",
    "file name.png",
  ])("accepts %j", (v) => {
    expect(uploadPathProblem(v)).toBeNull();
  });

  it.each([
    ["/etc/passwd", /absolute/],
    ["/proc/self/environ", /absolute/],
    ["\\\\server\\share\\x", /absolute/],
    ["\\windows\\win.ini", /absolute/],
    ["C:\\Users\\x\\id_rsa", /absolute/],
    ["c:/x", /absolute/],
    ["../x", /\.\. segment/],
    ["a/../../x", /\.\. segment/],
    ["a/../b", /\.\. segment/],
    ["a\\..\\b", /\.\. segment/],
    ["a//..//b", /\.\. segment/],
    ["..", /\.\. segment/],
    [".auth/default.json", /hidden segment/],
    [".docsxai.json", /hidden segment/],
    ["fixtures/.env", /hidden segment/],
    ["a/.hidden/b.png", /hidden segment/],
    ["./.auth/x.json", /hidden segment/],
    [".\\.auth\\x.json", /hidden segment/],
    ["webhook-job.json", /reserved file/],
    ["./Webhook-Job.JSON", /reserved file/],
    ["sub/webhook-job.json", /reserved file/],
    ["", /empty/],
    ["a\0b", /NUL/],
  ])("refuses %j", (v, why) => {
    expect(uploadPathProblem(v)).toMatch(why);
  });
});

describe("resolveUploadPath", () => {
  let root = "";
  let outside = "";
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-upload-root-")));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-upload-out-")));
    await fs.mkdir(path.join(root, "fixtures"));
    await fs.writeFile(path.join(root, "fixtures", "a.png"), "png");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("returns the real path of a regular file under the root", async () => {
    expect(await resolveUploadPath(root, "fixtures/a.png")).toBe(
      path.join(root, "fixtures", "a.png"),
    );
    expect(await resolveUploadPath(root, "./fixtures/a.png")).toBe(
      path.join(root, "fixtures", "a.png"),
    );
  });

  it("follows a symlink that stays inside the root", async () => {
    await fs.symlink(path.join(root, "fixtures", "a.png"), path.join(root, "alias.png"));
    expect(await resolveUploadPath(root, "alias.png")).toBe(path.join(root, "fixtures", "a.png"));
  });

  it.each(["/etc/passwd", "../x", "fixtures/../fixtures/a.png", ""])(
    "refuses the spelling %j",
    async (v) => {
      await expect(resolveUploadPath(root, v)).rejects.toBeInstanceOf(UploadPathError);
    },
  );

  it("refuses an absolute path to a file that exists", async () => {
    await expect(resolveUploadPath(root, path.join(outside, "secret.txt"))).rejects.toThrow(
      /is an absolute path/,
    );
  });

  it("refuses a symlink to a file outside the root", async () => {
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));
    await expect(resolveUploadPath(root, "leak.txt")).rejects.toThrow(/is outside the workspace/);
  });

  it("refuses a file reached through a symlinked directory that leaves the root", async () => {
    await fs.symlink(outside, path.join(root, "linked"));
    await expect(resolveUploadPath(root, "linked/secret.txt")).rejects.toThrow(
      /is outside the workspace/,
    );
  });

  it("refuses a hidden file that exists, by spelling and through a symlink", async () => {
    await fs.mkdir(path.join(root, ".auth"));
    await fs.writeFile(path.join(root, ".auth", "default.json"), "{}");
    await fs.writeFile(path.join(root, "webhook-job.json"), "{}");
    await expect(resolveUploadPath(root, ".auth/default.json")).rejects.toThrow(/hidden segment/);
    await expect(resolveUploadPath(root, "webhook-job.json")).rejects.toThrow(/reserved file/);
    await fs.symlink(path.join(root, ".auth", "default.json"), path.join(root, "innocent.json"));
    await expect(resolveUploadPath(root, "innocent.json")).rejects.toThrow(
      /leads to a path that has a hidden segment/,
    );
  });

  it("refuses a directory", async () => {
    await expect(resolveUploadPath(root, "fixtures")).rejects.toThrow(/is not a regular file/);
  });

  it("refuses a file that does not exist", async () => {
    await expect(resolveUploadPath(root, "fixtures/missing.png")).rejects.toThrow(
      /does not name a readable file/,
    );
  });
});
