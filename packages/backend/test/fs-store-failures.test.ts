import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FsStore } from "../src/fs-store.js";

const tmpDirs: string[] = [];
function dataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-fs-store-fail-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function leftovers(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.includes(".tmp-"));
}

describe("FsStore write failures", () => {
  it("removes the temp file when the rename fails", () => {
    const dir = dataDir();
    const store = new FsStore(dir);
    const ws = store.createWorkspace("w");
    const proj = store.createProject(ws.id, "p");
    const rev = store.createRevision(ws.id, proj.id, "calibrate", "x");
    // A directory where the artifact file belongs makes the rename fail.
    fs.mkdirSync(
      path.join(dir, "projects", proj.id, "revisions", rev.id, "artifacts", "flows.json"),
      { recursive: true },
    );
    expect(() => store.putArtifact(ws.id, proj.id, rev.id, "flows", { a: 1 })).toThrow();
    expect(leftovers(dir)).toEqual([]);
  });
});
