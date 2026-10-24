import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/index.js";
import { SpawnRunner } from "../src/runner.js";
import type { WebhookJob } from "../src/webhook.js";

const FAKE_BIN = fileURLToPath(new URL("./fixtures/fake-engine.cjs", import.meta.url));

const FLOWS = {
  schema: "docsxai/flows@1",
  files: {
    "checkout.flow.yaml":
      "name: checkout\nsteps:\n  - id: open\n    action: navigate\n    value: /checkout\n",
  },
};

function seed() {
  const store = new MemoryStore();
  const ws = store.createWorkspace("ws");
  const project = store.createProject(ws.id, "site");
  const rev = store.createRevision(ws.id, project.id, "run", "ci");
  store.putArtifact(ws.id, project.id, rev.id, "flows", FLOWS);
  const job: WebhookJob = {
    delivery_id: "d-1",
    event: "push",
    workspace_id: ws.id,
    project_id: project.id,
    repo: "octo-org/docs-site",
    config: {
      repo: "octo-org/docs-site",
      events: ["push"],
      strategy: "pr-comment",
      workspace_rev: "head",
      secret_env: "DOCSX_WEBHOOK_SECRET",
      enabled: true,
    },
    payload: {},
  };
  return { store, ws, project, rev, job };
}

const noteStrategy = async () => ({ strategy: "fake", ok: true, detail: "noted" });

describe("run history from a webhook run", () => {
  it("records the revision the run executed against when head moves mid-run", async () => {
    const { store, ws, project, rev, job } = seed();
    const runner = new SpawnRunner({
      store,
      engineBin: FAKE_BIN,
      // A new revision lands while the engine and the strategy run.
      strategy: async () => {
        store.createRevision(ws.id, project.id, "edit", "someone");
        return noteStrategy();
      },
    });
    await runner.executeRun(job);
    expect(store.listRuns(ws.id, project.id)[0]!.revision_id).toBe(rev.id);
  });

  it("records a failed run when the revision's payloads cannot be laid out", async () => {
    const { store, ws, project, rev, job } = seed();
    store.putArtifact(ws.id, project.id, rev.id, "flows", {
      schema: "docsxai/flows@1",
      files: { "../escape.flow.yaml": "name: x\n" },
    });
    const workRoot = fs.mkdtempSync(
      `${fs.realpathSync(process.env.TMPDIR ?? "/tmp")}/docsxai-rec-`,
    );
    try {
      const runner = new SpawnRunner({
        store,
        engineBin: FAKE_BIN,
        strategy: noteStrategy,
        workRoot,
      });
      await expect(runner.executeRun(job)).rejects.toThrow(/not a valid flows path/);
      const runs = store.listRuns(ws.id, project.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ ok: false, revision_id: rev.id });
      expect(runs[0]!.summary).toContain("[webhook push d-1]");
      expect(runs[0]!.summary).toContain("not a valid flows path");
      expect(fs.readdirSync(workRoot)).toEqual([]);
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it("records nothing, and rethrows, when the revision itself is missing", async () => {
    const { store, ws, project, job } = seed();
    job.config.workspace_rev = "no-such-revision";
    const runner = new SpawnRunner({ store, engineBin: FAKE_BIN, strategy: noteStrategy });
    await expect(runner.executeRun(job)).rejects.toThrow(/revision no-such-revision/);
    expect(store.listRuns(ws.id, project.id)).toEqual([]);
  });
});
