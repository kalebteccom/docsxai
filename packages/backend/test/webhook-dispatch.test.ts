import { describe, expect, it } from "vitest";
import { QueuedDispatcher, type WebhookJob } from "../src/webhook.js";
import type { WebhookConfig } from "../src/api.js";

const CONFIG: WebhookConfig = {
  repo: "octo-org/docs-site",
  events: ["push"],
  strategy: "pr-comment",
  workspace_rev: "head",
  secret_env: "DOCSX_WEBHOOK_SECRET",
  enabled: true,
};

const job = (project: string, id: string): WebhookJob => ({
  delivery_id: id,
  event: "push",
  workspace_id: "ws1",
  project_id: project,
  repo: CONFIG.repo,
  config: CONFIG,
  payload: {},
});

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("QueuedDispatcher", () => {
  it("runs two jobs for the same project strictly in arrival order", async () => {
    const events: string[] = [];
    const release = new Map<string, () => void>();
    const d = new QueuedDispatcher(
      (j) =>
        new Promise<void>((resolve) => {
          events.push(`start:${j.delivery_id}`);
          release.set(j.delivery_id, () => {
            events.push(`end:${j.delivery_id}`);
            resolve();
          });
        }),
    );
    await d.dispatch(job("A", "a1"));
    await d.dispatch(job("A", "a2"));
    await tick();
    expect(events).toEqual(["start:a1"]); // a2 must wait for a1
    release.get("a1")!();
    await tick();
    expect(events).toEqual(["start:a1", "end:a1", "start:a2"]);
    release.get("a2")!();
    await d.drain();
    expect(events).toEqual(["start:a1", "end:a1", "start:a2", "end:a2"]);
  });

  it("interleaves jobs for different projects", async () => {
    const events: string[] = [];
    const release = new Map<string, () => void>();
    const d = new QueuedDispatcher(
      (j) =>
        new Promise<void>((resolve) => {
          events.push(`start:${j.delivery_id}`);
          release.set(j.delivery_id, () => resolve());
        }),
    );
    await d.dispatch(job("A", "a1"));
    await d.dispatch(job("B", "b1"));
    await tick();
    expect(events).toEqual(["start:a1", "start:b1"]); // B does not wait for A
    release.get("a1")!();
    release.get("b1")!();
    await d.drain();
  });

  it("dispatch resolves before the job executes (202-before-run)", async () => {
    let ran = false;
    const d = new QueuedDispatcher(async () => {
      await tick();
      ran = true;
    });
    await d.dispatch(job("A", "a1"));
    expect(ran).toBe(false);
    await d.drain();
    expect(ran).toBe(true);
  });

  it("a failing job does not wedge the project queue and reports through onError", async () => {
    const failures: string[] = [];
    const ran: string[] = [];
    const d = new QueuedDispatcher(
      async (j) => {
        if (j.delivery_id === "boom") throw new Error("engine exploded");
        ran.push(j.delivery_id);
      },
      { onError: (j, e) => failures.push(`${j.delivery_id}:${(e as Error).message}`) },
    );
    await d.dispatch(job("A", "boom"));
    await d.dispatch(job("A", "after"));
    await d.drain();
    expect(failures).toEqual(["boom:engine exploded"]);
    expect(ran).toEqual(["after"]);
  });

  it("drain waits for jobs enqueued while draining", async () => {
    const ran: string[] = [];
    const d = new QueuedDispatcher(async (j) => {
      ran.push(j.delivery_id);
      if (j.delivery_id === "first") await d.dispatch(job("A", "second"));
    });
    await d.dispatch(job("A", "first"));
    await d.drain();
    expect(ran).toEqual(["first", "second"]);
  });
});
