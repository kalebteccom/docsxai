// GitHub webhook runtime: raw HMAC signature verification (no Probot — node:crypto only) and the
// execution-dispatch contract. The webhook endpoint is the only unauthenticated mutating route, so
// verification is strict: exact `sha256=<64 hex>` shape, constant-time compare, reject on any
// absence. Dispatch is fire-and-forget from the HTTP handler's perspective (202 Accepted); the
// QueuedDispatcher serializes runs per project so concurrent deliveries can't interleave a
// project's workspace.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookConfig } from "./api.js";

/** Header carrying the HMAC: `X-Hub-Signature-256: sha256=<hex>`. */
export const SIGNATURE_HEADER = "x-hub-signature-256";
export const EVENT_HEADER = "x-github-event";
export const DELIVERY_HEADER = "x-github-delivery";

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;

/**
 * Verify a GitHub `X-Hub-Signature-256` header against the raw request body. Constant-time
 * compare; returns false (never throws) for a missing or malformed header.
 */
export function verifyGitHubSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const m = SIGNATURE_RE.exec(header);
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const presented = Buffer.from(m[1]!, "hex");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Compute the `sha256=<hex>` signature value for a payload (test fixtures, local delivery). */
export function signGitHubPayload(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** A verified, event-filtered webhook delivery, ready to execute. */
export interface WebhookJob {
  delivery_id: string;
  /** GitHub event name (`push`, `pull_request`). */
  event: string;
  workspace_id: string;
  project_id: string;
  /** `owner/name`. */
  repo: string;
  config: WebhookConfig;
  /** The parsed webhook payload (opaque to the queue; strategies pull PR/commit ids from it). */
  payload: unknown;
}

/** The execution surface the webhook endpoint hands accepted deliveries to. */
export interface RunDispatcher {
  /** Accept a job. Must resolve fast — execution happens after the 202 goes out. */
  dispatch(job: WebhookJob): Promise<void>;
}

export type ExecuteRun = (job: WebhookJob) => Promise<void>;

export interface QueuedDispatcherOptions {
  /** Observe job failures (the queue itself never rejects — one bad job must not wedge it). */
  onError?: (job: WebhookJob, error: unknown) => void;
}

/**
 * In-process dispatcher: one serial queue per project (jobs for the same project run strictly in
 * arrival order; jobs for different projects interleave freely). `executeRun` is the abstract run
 * callback — `SpawnRunner.executeRun` in production, a fake in tests.
 */
export class QueuedDispatcher implements RunDispatcher {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly executeRun: ExecuteRun,
    private readonly opts: QueuedDispatcherOptions = {},
  ) {}

  dispatch(job: WebhookJob): Promise<void> {
    const tail = this.tails.get(job.project_id) ?? Promise.resolve();
    const next = tail.then(() =>
      Promise.resolve()
        .then(() => this.executeRun(job))
        .catch((e: unknown) => this.opts.onError?.(job, e)),
    );
    this.tails.set(job.project_id, next);
    this.inFlight.add(next);
    void next.finally(() => this.inFlight.delete(next));
    return Promise.resolve();
  }

  /** Resolve once every job dispatched so far (including ones enqueued mid-drain) has finished. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
