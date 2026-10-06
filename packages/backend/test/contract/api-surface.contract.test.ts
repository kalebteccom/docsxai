// Contract: the backend REST surface (route table, API version header, OAuth client id, resource
// shapes, error vocabulary) and the wire behaviour that clients depend on.
//
// Snapshot: snapshots/backend-api.json. The route table, constants and enums are runtime exports
// of `src/api.ts`; the resource shapes are interfaces, read from source text (syntax only); the
// error codes are collected from the `error: "..."` literals under `src/`.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed or renamed route, a removed response field or a changed
//      error code is a breaking change for every client; a new route or a new optional field is
//      additive. A breaking change needs a new `Docsxai-Api-Version` value.
//   3. Update docs/public-surface.md and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import { readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectJsonSnapshot,
  readSource,
  stringUnion,
  typeMembers,
} from "../../../../scripts/contract-support.js";
import {
  API_VERSION,
  API_VERSION_HEADER,
  BLOB_BODY_LIMIT_BYTES,
  DEFAULT_WEBHOOK_SECRET_ENV,
  JSON_BODY_LIMIT_BYTES,
  OAUTH_CLIENT_ID,
  REVISION_ARTIFACTS,
  ROUTES,
  WEBHOOK_EVENTS,
  WEBHOOK_STRATEGIES,
  createBackendStub,
} from "../../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "src");
const apiSource = path.join(src, "api.ts");

function errorCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    for (const m of readSource(path.join(src, file)).matchAll(/error: "([A-Za-z_-]+)"/g)) {
      codes.add(m[1]!);
    }
  }
  return [...codes].sort();
}

describe("backend API contract", () => {
  it("matches the checked-in API snapshot", () => {
    expectJsonSnapshot(path.join(here, "snapshots", "backend-api.json"), {
      apiVersion: API_VERSION,
      apiVersionHeader: API_VERSION_HEADER,
      oauthClientId: OAUTH_CLIENT_ID,
      limits: { jsonBodyBytes: JSON_BODY_LIMIT_BYTES, blobBodyBytes: BLOB_BODY_LIMIT_BYTES },
      revisionArtifacts: [...REVISION_ARTIFACTS],
      revisionKinds: stringUnion(apiSource, "RevisionKind"),
      webhookEvents: [...WEBHOOK_EVENTS],
      webhookStrategies: [...WEBHOOK_STRATEGIES],
      webhookSecretEnv: DEFAULT_WEBHOOK_SECRET_ENV,
      errorCodes: errorCodes(),
      routes: ROUTES.map((r) => `${r.method} ${r.path}`),
      types: {
        Workspace: typeMembers(apiSource, "Workspace"),
        Project: typeMembers(apiSource, "Project"),
        Revision: typeMembers(apiSource, "Revision"),
        RunRecord: typeMembers(apiSource, "RunRecord"),
        ApiError: typeMembers(apiSource, "ApiError"),
        BlobRef: typeMembers(apiSource, "BlobRef"),
        AuthCacheEnvelope: typeMembers(apiSource, "AuthCacheEnvelope"),
        WebhookConfig: typeMembers(apiSource, "WebhookConfig"),
      },
    });
  });
});

describe("backend wire contract", () => {
  let base = "";
  let stub: ReturnType<typeof createBackendStub>;
  beforeAll(async () => {
    stub = createBackendStub({ token: "contract-token" });
    base = await stub.listen(0);
  });
  afterAll(async () => {
    await stub.close();
  });

  it("serves /v1/health without auth and echoes the API version on every response", async () => {
    const r = await fetch(`${base}/v1/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: API_VERSION });
    expect(r.headers.get(API_VERSION_HEADER)).toBe(API_VERSION);
  });

  it("warns, without failing, when the client announces another API version", async () => {
    const r = await fetch(`${base}/v1/health`, { headers: { [API_VERSION_HEADER]: "99" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("warning")).toMatch(/^199 /);
  });

  it("answers a missing bearer token with 401, a Bearer challenge and { error, message }", async () => {
    const r = await fetch(`${base}/v1/workspaces`);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const body = (await r.json()) as { error: string; message: string };
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(body.error).toBe("unauthorized");
  });

  it("answers an unknown path with 404 and error not_found", async () => {
    const r = await fetch(`${base}/v1/no-such-route`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe("not_found");
  });
});
