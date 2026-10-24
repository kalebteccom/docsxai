import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FsStore, MemoryStore, RUN_HISTORY_LIMIT, type RunRecord } from "../src/index.js";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const input = (summary: string) => ({ rev: "head", ok: true, duration_ms: 1, summary });

describe("run-history cap", () => {
  it("MemoryStore keeps the newest RUN_HISTORY_LIMIT records", () => {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "p");
    store.createRevision(ws.id, project.id, "run", "ci");
    for (let i = 0; i < RUN_HISTORY_LIMIT + 3; i++) {
      store.appendRun(ws.id, project.id, input(`run ${i}`));
    }
    const runs = store.listRuns(ws.id, project.id);
    expect(runs).toHaveLength(RUN_HISTORY_LIMIT);
    expect(runs[0]?.summary).toBe(`run ${RUN_HISTORY_LIMIT + 2}`);
    expect(runs.at(-1)?.summary).toBe("run 3");
  });

  it("FsStore drops the oldest record once runs.json is full", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-run-cap-"));
    tmpDirs.push(dir);
    const store = new FsStore(dir);
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "p");
    const rev = store.createRevision(ws.id, project.id, "run", "ci");
    const full: RunRecord[] = Array.from({ length: RUN_HISTORY_LIMIT }, (_, i) => ({
      id: `old-${i}`,
      project_id: project.id,
      revision_id: rev.id,
      ok: true,
      duration_ms: i,
      summary: `run ${i}`,
      created_at: "2026-01-01T00:00:00.000Z",
    }));
    fs.writeFileSync(path.join(dir, "projects", project.id, "runs.json"), JSON.stringify(full));

    const added = store.appendRun(ws.id, project.id, input("newest"));
    const runs = store.listRuns(ws.id, project.id);
    expect(runs).toHaveLength(RUN_HISTORY_LIMIT);
    expect(runs[0]?.id).toBe(added.id);
    expect(runs.at(-1)?.id).toBe("old-1");
  });
});
