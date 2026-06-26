// GitHub App webhook receiver. Pulled out of the server closure into a standalone handler that
// takes the state it needs ({ store, env, dispatcher }) explicitly; the rest is pure plumbing from
// http.js. The route is unauthenticated but strictly verified — see the handler doc comment.

import { type IncomingMessage, type ServerResponse } from "node:http";
import { JSON_BODY_LIMIT_BYTES } from "./api.js";
import { asSingle, readBody, sendJson } from "./http.js";
import { type BackendStore } from "./store.js";
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  verifyGitHubSignature,
  type RunDispatcher,
  type WebhookJob,
} from "./webhook.js";

/** State the webhook handler needs from the server: store, secret-reading env, and the dispatcher. */
export interface WebhookHttpContext {
  store: BackendStore;
  env: NodeJS.ProcessEnv;
  dispatcher: RunDispatcher;
}

/**
 * GitHub webhook receiver. Unauthenticated route, but strictly verified: the repo named in the
 * payload must map to a configured project, and the X-Hub-Signature-256 HMAC must validate
 * against that project's secret (read from the env var the config names) before anything else
 * is trusted. Accepted deliveries are queued (202) — execution happens after the response.
 */
export async function handleGitHubWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebhookHttpContext,
): Promise<void> {
  const { store, env, dispatcher } = ctx;
  const raw = await readBody(req, JSON_BODY_LIMIT_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { error: "bad_request", message: "invalid JSON payload" });
  }
  const repo = (payload as { repository?: { full_name?: unknown } }).repository?.full_name;
  if (typeof repo !== "string" || !repo) {
    return sendJson(res, 400, {
      error: "bad_request",
      message: "payload missing repository.full_name",
    });
  }
  const match = store.findWebhookProject(repo);
  if (!match) {
    return sendJson(res, 404, {
      error: "not_found",
      message: `no project is configured for repository ${repo}`,
    });
  }
  // Signature gate. A missing secret in the env fails closed (401), never open.
  const secret = env[match.config.secret_env];
  const signature = req.headers[SIGNATURE_HEADER];
  if (!secret || !verifyGitHubSignature(secret, raw, asSingle(signature))) {
    res.setHeader("WWW-Authenticate", 'Signature realm="github-webhook"');
    return sendJson(res, 401, {
      error: "unauthorized",
      message: "missing or invalid X-Hub-Signature-256",
    });
  }
  const deliveryId = asSingle(req.headers[DELIVERY_HEADER]);
  if (!deliveryId) {
    return sendJson(res, 400, {
      error: "bad_request",
      message: "missing X-GitHub-Delivery header",
    });
  }
  if (!match.config.enabled) {
    return sendJson(res, 200, { delivery_id: deliveryId, dispatched: false, reason: "disabled" });
  }
  const event = asSingle(req.headers[EVENT_HEADER]) ?? "";
  if (!(match.config.events as string[]).includes(event)) {
    return sendJson(res, 200, {
      delivery_id: deliveryId,
      dispatched: false,
      reason: "event-filtered",
      event,
    });
  }
  if (!store.rememberWebhookDelivery(deliveryId)) {
    return sendJson(res, 200, { delivery_id: deliveryId, duplicate: true, dispatched: false });
  }
  const job: WebhookJob = {
    delivery_id: deliveryId,
    event,
    workspace_id: match.workspace_id,
    project_id: match.project_id,
    repo,
    config: match.config,
    payload,
  };
  await dispatcher.dispatch(job);
  return sendJson(res, 202, {
    delivery_id: deliveryId,
    project_id: match.project_id,
    dispatched: true,
  });
}
