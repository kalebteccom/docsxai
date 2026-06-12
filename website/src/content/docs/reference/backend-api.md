---
title: Backend API
description: The docsxai backend's REST surface endpoint by endpoint - workspaces, projects, immutable revisions, content-addressed blobs, the auth-cache relay, OAuth 2.1 with PKCE, and the GitHub webhook receiver.
---

The backend is a small authenticated service that persists doc packs:
projects, revisions, flow-files, screenshots, annotations, style artifacts,
and run history. `site-docs push` and `pull` are its CLI clients, and the
GitHub App integration is a webhook surface on this same service. Revisions
are linear and immutable: every push creates a new revision whose parent is
the current head, and finalizing freezes it.

Versioning: clients send a `Site-Docs-API-Version: 1` header; the server
echoes it and warns on mismatch.

## Authentication

Everything except `/v1/health` and the OAuth endpoints sits behind a bearer
gate, with two ways through:

- **CI token** - start the server with `SITE_DOCS_TOKEN` set; callers present
  it as `Authorization: Bearer <token>`.
- **OAuth 2.1 access token** - issued by the backend's own minimal
  authorization server (authorization-code with PKCE, S256 only, loopback
  redirect URIs only). `site-docs login --backend-url <url> --oauth
  <workspace>` drives the full handshake and stores tokens at
  `<workspace>/.auth/backend-token.json` (mode 0600). Refresh tokens rotate:
  the presented one is invalidated on use.

Failed auth gets a 401 with a `WWW-Authenticate: Bearer` header. The server
stores only sha256 hashes of issued tokens.

## Endpoints

### Workspaces and projects

| Method | Path                                  | What it does                              |
| ------ | ------------------------------------- | ------------------------------------------ |
| GET    | `/v1/health`                          | Liveness probe (no auth).                  |
| GET    | `/v1/workspaces`                      | List workspaces visible to the caller.     |
| POST   | `/v1/workspaces`                      | Create a workspace (`{ name }`).           |
| GET    | `/v1/workspaces/:ws`                  | Get a workspace.                           |
| GET    | `/v1/workspaces/:ws/projects`         | List projects in a workspace.              |
| POST   | `/v1/workspaces/:ws/projects`         | Create a project (`{ name }`).             |
| GET    | `/v1/workspaces/:ws/projects/:project`| Get a project (incl. head revision).       |

### Revisions and artifacts

| Method | Path                                                            | What it does                                                        |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions`                | List revisions (newest first).                                       |
| POST   | `/v1/workspaces/:ws/projects/:project/revisions`                | Create a revision (`{ kind: calibrate\|run\|edit, author }`); parent is the current head. |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions/:rev`           | Revision metadata plus which artifacts are present. `:rev` may be `head`. |
| POST   | `/v1/workspaces/:ws/projects/:project/revisions/:rev/finalize`  | Finalize (idempotent). Artifact PUTs afterwards get 409 `revision-finalized`. |
| GET    | `/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact` | Get an artifact payload.                                             |
| PUT    | `/v1/workspaces/:ws/projects/:project/revisions/:rev/:artifact` | Replace an artifact payload on a non-finalized revision.             |

The artifact slots mirror the on-disk doc pack: `flows`, `annotations`,
`screenshots`, `style`, `locators`. Payloads are opaque to the backend; the
schemas (`site-docs/flows@1`, `site-docs/screenshots@2`, and friends) are the
engine's contract.

### Run history

| Method | Path                                              | What it does                                                  |
| ------ | -------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/v1/workspaces/:ws/projects/:project/run-history` | List execution-run records (newest first).                      |
| POST   | `/v1/workspaces/:ws/projects/:project/run-history` | Append a record (`{ rev, ok, duration_ms, summary }`).          |

### Blobs

Binary artifacts never travel as base64-in-JSON. The `screenshots` artifact
slot carries a manifest (`site-docs/screenshots@2`: path to
`{ sha256, bytes }`); the bytes move through the blob endpoints:

| Method | Path                | What it does                                                              |
| ------ | ------------------- | --------------------------------------------------------------------------- |
| POST   | `/v1/blobs`         | Store a content-addressed blob (raw body, up to 25 MB). Returns `{ sha256, bytes }`. Idempotent. |
| HEAD   | `/v1/blobs/:sha256` | Probe whether a blob exists (200 with Content-Length, or 404).             |
| GET    | `/v1/blobs/:sha256` | Fetch the raw bytes (`application/octet-stream`).                          |

`push` HEAD-probes before every upload, so an unchanged screenshot costs one
HEAD; blobs are deduplicated across revisions and projects. `pull` verifies
every fetched blob against its manifest hash.

### Auth-cache relay (zero-knowledge)

| Method | Path                                   | What it does                                            |
| ------ | -------------------------------------- | ---------------------------------------------------------- |
| PUT    | `/v1/workspaces/:ws/auth-cache/:role`  | Store a client-side-encrypted storage-state envelope.     |
| GET    | `/v1/workspaces/:ws/auth-cache/:role`  | Fetch the envelope for a role.                            |
| DELETE | `/v1/workspaces/:ws/auth-cache/:role`  | Delete it (idempotent).                                   |

The envelope (`site-docs/auth-cache@1`) is AES-256-GCM ciphertext encrypted
in the engine with a key from `SITE_DOCS_CACHE_KEY` that never leaves the
client; the backend validates the shape and stores it opaquely. This is how a
team shares captured target-site sessions without the backend ever seeing a
plaintext cookie.

### OAuth

| Method | Path                  | What it does                                                                          |
| ------ | --------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/v1/oauth/authorize` | Authorization endpoint (PKCE S256 only, loopback redirect URIs only). 302 with `?code=&state=`. Codes are single-use, five-minute TTL, bound to the challenge and redirect URI. |
| POST   | `/v1/oauth/token`     | Token endpoint (form-encoded): `authorization_code` + PKCE verifier, or `refresh_token` (rotating). |

The only registered client is `site-docs-cli`.

### GitHub webhook

| Method | Path                                                   | What it does                                              |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------ |
| GET    | `/v1/workspaces/:ws/projects/:project/webhook-config`  | Get the project's webhook config (404 when unset).          |
| PUT    | `/v1/workspaces/:ws/projects/:project/webhook-config`  | Set it (`{ repo, events, strategy, ... }`).                  |
| POST   | `/v1/github/webhook`                                   | The receiver: no bearer auth, strictly HMAC-verified. 202 on dispatch. |

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

## Limits and errors

JSON bodies are capped at 10 MB and raw blobs at 25 MB; over-limit requests
get 413 `{ "error": "payload_too_large" }`. Errors are uniform
`{ error, message }` JSON. Artifact writes after finalize get 409
`{ "error": "revision-finalized" }`.

## Persistence

Storage is in-memory by default and filesystem-backed with a data dir
(`--data-dir=`, `dataDir`, or `SITE_DOCS_DATA_DIR`): atomic writes, reads
always from disk, every path containment-guarded against the data root.
The endpoint shape is what production will be; a hosted multi-tenant
deployment is owner-gated. See the [package page](/packages/backend/) for
the store layout and the GitHub App registration checklist.
