import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WebhookConfig } from "../src/api.js";
import { MemoryStore } from "../src/index.js";
import { ENGINE_BIN_ENV, resolveEngineBin, SpawnRunner } from "../src/runner.js";
import type { StrategyResult } from "../src/strategy.js";
import type { WebhookJob } from "../src/webhook.js";

const FAKE_BIN = fileURLToPath(new URL("./fixtures/fake-engine.cjs", import.meta.url));

const CHECKOUT_FLOW = `name: checkout
steps:
  - id: open
    action: navigate
    value: /checkout
`;
const FLOWS = { schema: "docsxai/flows@1", files: { "checkout.flow.yaml": CHECKOUT_FLOW } };

function seed(config: Partial<WebhookConfig> = {}) {
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
      ...config,
    },
    payload: {},
  };
  return { store, ws, project, rev, job };
}

const okStrategy =
  (calls: Array<{ workspace_dir: string; ok: boolean }>) =>
  async (_job: WebhookJob, outcome: { workspace_dir: string; ok: boolean }) => {
    calls.push({ workspace_dir: outcome.workspace_dir, ok: outcome.ok });
    return { strategy: "fake", ok: true, detail: "noted" } satisfies StrategyResult;
  };

describe("SpawnRunner", () => {
  it("materializes the revision's artifacts, runs the engine, and appends ok run-history", async () => {
    const { store, ws, project, rev, job } = seed();
    const calls: Array<{ workspace_dir: string; ok: boolean }> = [];
    const runner = new SpawnRunner({
      store,
      engineBin: FAKE_BIN,
      strategy: okStrategy(calls),
      keepWorkspace: true,
    });
    const outcome = await runner.executeRun(job);
    try {
      expect(outcome.ok).toBe(true);
      expect(outcome.exit_code).toBe(0);
      expect(outcome.summary).toContain("documented 3 flows");
      // The fake engine saw an engine-shaped workspace (flows/<name>.flow.yaml, .docsxai.json,
      // docs/) and wrote its marker.
      expect(
        fs.readFileSync(path.join(outcome.workspace_dir, "flows", "checkout.flow.yaml"), "utf8"),
      ).toBe(CHECKOUT_FLOW);
      expect(fs.existsSync(path.join(outcome.workspace_dir, "flows.json"))).toBe(false);
      expect(fs.statSync(path.join(outcome.workspace_dir, "docs")).isDirectory()).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.join(outcome.workspace_dir, ".docsxai.json"), "utf8")),
      ).toMatchObject({ schema: "docsxai/workspace@1" });
      expect(fs.existsSync(path.join(outcome.workspace_dir, "fake-run.json"))).toBe(true);
      expect(calls).toEqual([{ workspace_dir: outcome.workspace_dir, ok: true }]);

      const runs = store.listRuns(ws.id, project.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ ok: true, revision_id: rev.id });
      expect(runs[0]!.summary).toContain("[webhook push d-1]");
      expect(runs[0]!.summary).toContain("fake: noted");
    } finally {
      fs.rmSync(outcome.workspace_dir, { recursive: true, force: true });
    }
  });

  it("writes the configured app url into .docsxai.json", async () => {
    const { store, job } = seed();
    const runner = new SpawnRunner({
      store,
      engineBin: FAKE_BIN,
      strategy: okStrategy([]),
      appUrl: "http://localhost:3000",
      keepWorkspace: true,
    });
    const outcome = await runner.executeRun(job);
    try {
      expect(
        JSON.parse(fs.readFileSync(path.join(outcome.workspace_dir, ".docsxai.json"), "utf8")),
      ).toMatchObject({ app_url: "http://localhost:3000" });
    } finally {
      fs.rmSync(outcome.workspace_dir, { recursive: true, force: true });
    }
  });

  it("records a failed run (non-zero exit) and still routes the strategy", async () => {
    const { store, ws, project, job } = seed();
    const calls: Array<{ workspace_dir: string; ok: boolean }> = [];
    const runner = new SpawnRunner({
      store,
      engineBin: FAKE_BIN,
      env: { ...process.env, FAKE_ENGINE_EXIT: "1" },
      strategy: okStrategy(calls),
    });
    const outcome = await runner.executeRun(job);
    expect(outcome.ok).toBe(false);
    expect(outcome.exit_code).toBe(1);
    expect(calls).toEqual([{ workspace_dir: outcome.workspace_dir, ok: false }]);
    const runs = store.listRuns(ws.id, project.id);
    expect(runs[0]!.ok).toBe(false);
  });

  it("cleans up the temp workspace unless keepWorkspace is set", async () => {
    const { store, job } = seed();
    const runner = new SpawnRunner({ store, engineBin: FAKE_BIN, strategy: okStrategy([]) });
    const outcome = await runner.executeRun(job);
    expect(fs.existsSync(outcome.workspace_dir)).toBe(false);
  });

  it("marks the run failed (run-history) when the strategy throws", async () => {
    const { store, ws, project, job } = seed();
    const runner = new SpawnRunner({
      store,
      engineBin: FAKE_BIN,
      strategy: () => Promise.reject(new Error("wiki down")),
    });
    const outcome = await runner.executeRun(job);
    expect(outcome.ok).toBe(true); // engine itself passed
    expect(outcome.strategy).toMatchObject({ ok: false });
    const runs = store.listRuns(ws.id, project.id);
    expect(runs[0]!.ok).toBe(false);
    expect(runs[0]!.summary).toContain("wiki down");
  });

  it("runs against a pinned (non-head) revision id", async () => {
    const { store, ws, project, rev } = seed();
    // Move head past the pinned revision.
    store.createRevision(ws.id, project.id, "edit", "someone");
    const pinned: WebhookJob = {
      delivery_id: "d-2",
      event: "push",
      workspace_id: ws.id,
      project_id: project.id,
      repo: "octo-org/docs-site",
      config: {
        repo: "octo-org/docs-site",
        events: ["push"],
        strategy: "pr-comment",
        workspace_rev: rev.id,
        secret_env: "DOCSX_WEBHOOK_SECRET",
        enabled: true,
      },
      payload: {},
    };
    const runner = new SpawnRunner({ store, engineBin: FAKE_BIN, strategy: okStrategy([]) });
    await runner.executeRun(pinned);
    const runs = store.listRuns(ws.id, project.id);
    expect(runs[0]!.revision_id).toBe(rev.id);
  });
});

describe("resolveEngineBin", () => {
  it("prefers an existing DOCSX_ENGINE_BIN", () => {
    expect(resolveEngineBin({ [ENGINE_BIN_ENV]: FAKE_BIN })).toBe(FAKE_BIN);
  });

  it("ignores a dangling DOCSX_ENGINE_BIN and falls back", () => {
    const dangling = path.join(os.tmpdir(), `no-such-bin-${Date.now()}`);
    const resolved = resolveEngineBin({ [ENGINE_BIN_ENV]: dangling });
    expect(resolved).not.toBe(dangling);
    expect(resolved.length).toBeGreaterThan(0);
  });
});
