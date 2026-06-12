---
title: Backend API
description: The docsxai backend's REST surface endpoint by endpoint - workspaces, projects, immutable revisions, content-addressed blobs, the auth-cache relay, OAuth 2.1 with PKCE, and the GitHub webhook receiver.
---

The backend is a small authenticated service that persists doc packs:
projects, revisions, flow-files, screenshots, annotations, style artifacts,
and run history. `docsxai push` and `pull` are its CLI clients, and the
GitHub App integration is a webhook surface on this same service. Revisions
are linear and immutable: every push creates a new revision whose parent is
the current head, and finalizing freezes it.

Versioning: clients send a `Docsxai-Api-Version: 1` header; the server
echoes it and warns on mismatch.

## Authentication

Everything except `/v1/health` and the OAuth endpoints sits behind a bearer
gate, with two ways through:

- **CI token** - start the server with `DOCSX_TOKEN` set; callers present
  it as `Authorization: Bearer <token>`.
- **OAuth 2.1 access token** - issued by the backend's own minimal
  authorization server (authorization-code with PKCE, S256 only, loopback
  redirect URIs only). `docsxai login --backend-url <url> --oauth <workspace>`
  drives the full handshake and stores tokens at
  `<workspace>/.auth/backend-token.json` (mode 0600). Refresh tokens rotate:
  the presented one is invalidated on use.

Failed auth gets a 401 with a `WWW-Authenticate: Bearer` header. The server
stores only sha256 hashes of issued tokens.

## Endpoints

### Workspaces and projects

| Method | Path                                   | What it does                           |
| ------ | -------------------------------------- | -------------------------------------- |
| GET    | `/v1/health`                           | Liveness probe (no auth).              |
| GET    | `/v1/workspaces`                       | List workspaces visible to the caller. |
| POST   | `/v1/workspaces`                       | Create a workspace (`{ name }`).       |
| GET    | `/v1/workspaces/:ws`                   | Get a workspace.                       |
| GET    | `/v1/workspaces/:ws/projects`          | List projects in a workspace.          |
| POST   | `/v1/workspaces/:ws/projects`          | Create a project (`{ name }`).         |
| GET    | `/v1/workspaces/:ws/projects/:project` | Get a project (incl. head revision).   |

```sh
export BASE=http://127.0.0.1:4477   # e.g. docsxai-backend --port=4477
export AUTH="Authorization: Bearer $DOCSX_TOKEN"
export VER="Docsxai-Api-Version: 1"

curl -s $BASE/v1/health
# {"ok":true,"version":"1"}

curl -s -X POST $BASE/v1/workspaces -H "$AUTH" -H "$VER" \
  -H "Content-Type: application/json" -d '{"name":"acme-docs"}'
# {"id":"6f51…","name":"acme-docs","created_at":"2026-06-12T09:00:00.000Z"}

curl -s -X POST $BASE/v1/workspaces/6f51…/projects -H "$AUTH" -H "$VER" \
  -H "Content-Type: application/json" -d '{"name":"web-app"}'
# {"id":"a90c…","workspace_id":"6f51…","name":"web-app","created_at":"…","head_revision_id":null}
```

### Revisions and artifacts

| Method | Path                                                            | What it does                                                                              |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions`                | List revisions (newest first).                                                            |
| POST   | `/v1/workspaces/:ws/projects/:project/revisions`                | Create a revision (`{ kind: calibrate\|run\|edit, author }`); parent is the current head. |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions/:rev`           | Revision metadata plus which artifacts are present. `:rev` may be `head`.                 |
| POST   | `/v1/workspaces/:ws/projects/:project/revisions/:rev/finalize`  | Finalize (idempotent). Artifact PUTs afterwards get 409 `revision-finalized`.             |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact` | Get an artifact payload.                                                                  |
| PUT    | `/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact` | Replace an artifact payload on a non-finalized revision.                                  |

The artifact slots mirror the on-disk doc pack: `flows`, `annotations`,
`screenshots`, `style`, `locators`. Payloads are opaque to the backend; the
schemas (`docsxai/flows@1`, `docsxai/screenshots@2`, and friends) are the
engine's contract.

The push lifecycle, by hand (what `docsxai push` does for you):

```sh
# 1. open a revision
curl -s -X POST $BASE/v1/workspaces/6f51…/projects/a90c…/revisions \
  -H "$AUTH" -H "$VER" -H "Content-Type: application/json" \
  -d '{"kind":"run","author":"ci"}'
# {"id":"1d4f…","parent_revision_id":null,"kind":"run","author":"ci","artifacts":[],"finalized":false,…}

# 2. fill an artifact slot
curl -s -X PUT $BASE/v1/workspaces/6f51…/projects/a90c…/revisions/1d4f…/locators \
  -H "$AUTH" -H "$VER" -H "Content-Type: application/json" -d @docs/locators.json

# 3. seal it
curl -s -X POST $BASE/v1/workspaces/6f51…/projects/a90c…/revisions/1d4f…/finalize -H "$AUTH" -H "$VER"

# a PUT after finalize:
# 409 {"error":"revision-finalized","message":"…"}
```

### Run history

| Method | Path                                               | What it does                                           |
| ------ | -------------------------------------------------- | ------------------------------------------------------ |
| GET    | `/v1/workspaces/:ws/projects/:project/run-history` | List execution-run records (newest first).             |
| POST   | `/v1/workspaces/:ws/projects/:project/run-history` | Append a record (`{ rev, ok, duration_ms, summary }`). |

```sh
curl -s $BASE/v1/workspaces/6f51…/projects/a90c…/run-history -H "$AUTH" -H "$VER"
# [{"id":"…","project_id":"a90c…","revision_id":"1d4f…","ok":true,"duration_ms":48211,"summary":"3/3 flows ok","created_at":"…"}]
```

### Blobs

Binary artifacts never travel as base64-in-JSON. The `screenshots` artifact
slot carries a manifest (`docsxai/screenshots@2`: path to
`{ sha256, bytes }`); the bytes move through the blob endpoints:

| Method | Path                | What it does                                                                                     |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/v1/blobs`         | Store a content-addressed blob (raw body, up to 25 MB). Returns `{ sha256, bytes }`. Idempotent. |
| HEAD   | `/v1/blobs/:sha256` | Probe whether a blob exists (200 with Content-Length, or 404).                                   |
| GET    | `/v1/blobs/:sha256` | Fetch the raw bytes (`application/octet-stream`).                                                |

`push` HEAD-probes before every upload, so an unchanged screenshot costs one
HEAD; blobs are deduplicated across revisions and projects. `pull` verifies
every fetched blob against its manifest hash.

```sh
curl -s -X POST $BASE/v1/blobs -H "$AUTH" -H "$VER" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @docs/publish-post/screenshots/publish.png
# {"sha256":"3b6fa2…","bytes":184211}

curl -sI $BASE/v1/blobs/3b6fa2… -H "$AUTH" -H "$VER" | head -2
# HTTP/1.1 200 OK
# Content-Length: 184211
```

### Auth-cache relay (zero-knowledge)

| Method | Path                                  | What it does                                          |
| ------ | ------------------------------------- | ----------------------------------------------------- |
| PUT    | `/v1/workspaces/:ws/auth-cache/:role` | Store a client-side-encrypted storage-state envelope. |
| GET    | `/v1/workspaces/:ws/auth-cache/:role` | Fetch the envelope for a role.                        |
| DELETE | `/v1/workspaces/:ws/auth-cache/:role` | Delete it (idempotent).                               |

The envelope (`docsxai/auth-cache@1`) is AES-256-GCM ciphertext encrypted
in the engine with a key from `DOCSX_CACHE_KEY` that never leaves the
client; the backend validates the shape and stores it opaquely. This is how a
team shares captured target-site sessions without the backend ever seeing a
plaintext cookie.

```sh
curl -s -X PUT $BASE/v1/workspaces/6f51…/auth-cache/editor -H "$AUTH" -H "$VER" \
  -H "Content-Type: application/json" \
  -d '{"schema":"docsxai/auth-cache@1","alg":"aes-256-gcm","iv":"<b64>","ciphertext":"<b64>","tag":"<b64>","expires_at":1781280011000}'
```

You rarely call this by hand: setting a role's cache to `store: backend` in
`auth/strategy.yaml` makes the engine relay through it on capture and load.

### OAuth

| Method | Path                  | What it does                                                                                                                                                                    |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/oauth/authorize` | Authorization endpoint (PKCE S256 only, loopback redirect URIs only). 302 with `?code=&state=`. Codes are single-use, five-minute TTL, bound to the challenge and redirect URI. |
| POST   | `/v1/oauth/token`     | Token endpoint (form-encoded): `authorization_code` + PKCE verifier, or `refresh_token` (rotating).                                                                             |

The only registered client is `docsxai-cli`.
`docsxai login --backend-url <url> --oauth <workspace>` drives both endpoints
for you; the form-encoded token exchange underneath looks like:

```sh
curl -s -X POST $BASE/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d 'grant_type=authorization_code&client_id=docsxai-cli&code=<code>&code_verifier=<verifier>&redirect_uri=http://127.0.0.1:51723/callback'
# {"access_token":"…","refresh_token":"…","token_type":"Bearer","expires_in":3600}
```

### GitHub webhook

| Method | Path                                                  | What it does                                                           |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/v1/workspaces/:ws/projects/:project/webhook-config` | Get the project's webhook config (404 when unset).                     |
| PUT    | `/v1/workspaces/:ws/projects/:project/webhook-config` | Set it (`{ repo, events, strategy, ... }`).                            |
| POST   | `/v1/github/webhook`                                  | The receiver: no bearer auth, strictly HMAC-verified. 202 on dispatch. |

The webhook surface is what turns a GitHub push or pull request into a doc
refresh, with zero YAML in user repos - everything per-project lives in the
backend's webhook config (`repo`, `events: push|pull_request`, an output
`strategy`, the revision to run against, the env var holding the HMAC
secret). Deliveries are verified with a constant-time `X-Hub-Signature-256`
check (failing closed if the secret env var is unset), filtered by event,
replay-guarded by delivery id, then dispatched serially per project: the
revision's artifacts are materialized into a temp workspace, the engine CLI
runs them, and the output goes to one of three strategies - `pr-comment`
(run summary on the PR or commit), `viewer-refresh` (re-render the viewer,
store `index.html` as a blob), or `wiki-push` (load a publisher plugin and
report its result into run history).

```sh
curl -s -X PUT $BASE/v1/workspaces/6f51…/projects/a90c…/webhook-config \
  -H "$AUTH" -H "$VER" -H "Content-Type: application/json" \
  -d '{
    "repo": "acme/web-app",
    "events": ["push"],
    "strategy": "pr-comment",
    "workspace_rev": "head",
    "secret_env": "DOCSX_WEBHOOK_SECRET"
  }'
```

## Limits and errors

JSON bodies are capped at 10 MB and raw blobs at 25 MB; over-limit requests
get 413 `{ "error": "payload_too_large" }`. Errors are uniform
`{ error, message }` JSON. Artifact writes after finalize get 409
`{ "error": "revision-finalized" }`.

## Persistence

Storage is in-memory by default and filesystem-backed with a data dir
(`--data-dir=`, `dataDir`, or `DOCSX_DATA_DIR`): atomic writes, reads
always from disk, every path containment-guarded against the data root.
The endpoint shape is what production will be; a hosted multi-tenant
deployment is owner-gated. See the [package page](/packages/backend/) for
the store layout and the GitHub App registration checklist.
