# @kalebtec/docsxai-backend

Authenticated service that persists doc packs (projects, revisions, flow-files, screenshots, annotations, style artifacts, run history). REST + per-resource endpoints; OAuth 2.1 (authorization-code + PKCE) plus a pre-issued CI bearer token; content-addressed blob storage; immutable finalized revisions.

**Status:** the endpoint shape is what production will be. Storage is in-memory by default and filesystem-backed with a data dir; a hosted multi-tenant deployment (real consent UI, durable token store, DB) is post-MVP and owner-gated.

## Surface

- **`ROUTES`** in `src/api.ts` — the canonical endpoint list. `/v1/workspaces/{ws}/projects/{p}/revisions/{rev}/{flows|annotations|screenshots|style|locators}`, plus run history, blobs, the auth-cache relay, and the OAuth endpoints. Versioned via the `Site-Docs-API-Version` header.
- **Linear immutable revisions** — every `calibrate` / `run` / human edit creates a new revision with `id` / `parent_revision_id` / `kind` / `author` / `created_at`. No branches; concurrent-edit conflicts surface as failed pushes resolved via re-pull + re-edit.
- **`createBackendStub({ token?, store?, dataDir? })`** — starts the server bound to loopback; used by the engine's integration tests and as the local dev backend.
- **`docsxai-backend`** bin — the same server as a standalone process: `docsxai-backend --port=4477 --data-dir=~/.site-docs-data`.

## Persistence modes

| Mode                    | Selection                                                     | Layout                         |
| ----------------------- | ------------------------------------------------------------- | ------------------------------ |
| `MemoryStore` (default) | no `dataDir`, no `SITE_DOCS_DATA_DIR`                         | per-process, resets on restart |
| `FsStore`               | `dataDir` option, `--data-dir=` flag, or `SITE_DOCS_DATA_DIR` | see below                      |
| custom                  | pass any `BackendStore` implementation via `store`            | yours                          |

`FsStore` layout under the data dir:

```
workspaces.json
projects/<projectId>/meta.json
projects/<projectId>/runs.json
projects/<projectId>/revisions/<revId>/meta.json
projects/<projectId>/revisions/<revId>/artifacts/<slot>.json
blobs/<sha256>            ← content-addressed, shared across revisions
auth-cache/<wsId>/<role>.json
```

Writes are atomic (tmp file + rename); reads always go to disk, so multiple processes pointed at one data dir stay consistent. Every path join is containment-guarded against the data root — traversal-shaped ids read as not-found and traversal-shaped writes throw.

## Blob protocol

Binary artifacts (screenshots) never travel as base64-in-JSON. The flow:

1. `POST /v1/blobs` with the raw bytes (≤ 25 MB) → `{ sha256, bytes }`. Idempotent — the server computes the hash; re-posting the same bytes is a no-op.
2. `HEAD /v1/blobs/:sha256` → 200/404, so clients skip uploads for bytes the backend already has (`site-docs push` HEAD-probes before every upload).
3. The `screenshots` artifact slot carries a manifest, not bytes: `{ schema: "site-docs/screenshots@2", files: { "<flow>/screenshots/<file>.png": { sha256, bytes } } }`.
4. `GET /v1/blobs/:sha256` returns the raw bytes; pulls fetch the manifest, then the blobs, and verify each against its hash.

Blobs are deduplicated across revisions and projects — an unchanged screenshot costs one HEAD per push.

## Revision finalization

`POST .../revisions/:rev/finalize` marks a revision immutable (idempotent; `GET` reflects `finalized: true`). Artifact `PUT`s on a finalized revision are rejected with **409** `{ "error": "revision-finalized" }`. `site-docs push` finalizes after uploading all artifacts, so a pushed revision is a sealed snapshot; new revisions are unaffected.

## Auth

Two ways through the bearer gate (everything except `/v1/health` and the OAuth endpoints):

- **CI token** — start the server with `SITE_DOCS_TOKEN` set (or the `token` option); callers present it as `Authorization: Bearer <token>`. If no token is configured the stub accepts any non-empty bearer.
- **OAuth 2.1 access token** — issued by the built-in authorization server, below.

Failed auth → **401** with a `WWW-Authenticate: Bearer` header.

### OAuth 2.1 + PKCE endpoints

The backend is its own minimal authorization server:

- `GET /v1/oauth/authorize?client_id=site-docs-cli&code_challenge=<S256>&code_challenge_method=S256&redirect_uri=http://127.0.0.1:<port>/callback&state=…` → **302** to the redirect URI with `code` + `state`. Codes are single-use, 5-minute TTL, bound to the challenge + redirect URI. Only loopback redirect URIs are accepted; only `S256`.
- `POST /v1/oauth/token` (form-encoded) — `grant_type=authorization_code` (+ `code`, `code_verifier`) → `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`; `grant_type=refresh_token` rotates (the presented refresh token is invalidated).

Consent is stub-grade by design: the authorize request is auto-approved when it carries `Authorization: Bearer <SITE_DOCS_TOKEN>` **or** when `SITE_DOCS_OAUTH_AUTO_APPROVE=1`. A real interactive consent UI is hosted-deployment scope (owner-gated). Tokens are random 32-byte values; the server stores only their sha256 hashes (with expiry + workspace scope; `null` scope = all workspaces, matching today's stub semantics). Issued tokens live in process memory — they don't survive a restart; the CI-token path does.

`site-docs login --backend-url <url> --oauth <workspace>` drives the full handshake from the CLI and stores the tokens at `<workspace>/.auth/backend-token.json` (mode 0600).

## Auth-cache relay (zero-knowledge)

`PUT` / `GET` / `DELETE` `/v1/workspaces/:ws/auth-cache/:role` relays a **client-side-encrypted** storage-state envelope so a team can share captured target-site sessions through the backend:

```json
{
  "schema": "site-docs/auth-cache@1",
  "alg": "aes-256-gcm",
  "iv": "…",
  "ciphertext": "…",
  "tag": "…",
  "expires_at": 1750000000000
}
```

The backend validates the envelope shape and stores it opaquely — **it never sees the plaintext session**. Encryption happens in the engine (`BackendStateCache` in `@kalebtec/docsxai-engine`) with a 32-byte key from `SITE_DOCS_CACHE_KEY` that never leaves the client. Malformed envelopes → 400; `DELETE` is idempotent.

## Body limits

| Body                        | Limit | Over-limit response                        |
| --------------------------- | ----- | ------------------------------------------ |
| JSON (all JSON endpoints)   | 10 MB | **413** `{ "error": "payload_too_large" }` |
| Raw blob (`POST /v1/blobs`) | 25 MB | **413** `{ "error": "payload_too_large" }` |

## GitHub App (webhook surface)

The GitHub integration is a **webhook surface on this backend** — one service, no Probot, no
separate worker. Signature verification is raw `node:crypto` HMAC; GitHub API calls are plain
`fetch`. Install-and-go: user repos carry **zero YAML** — everything per-project lives in the
backend's webhook config.

```
GitHub push/PR ──▶ POST /v1/github/webhook          (no bearer auth; HMAC-verified)
                     │  repo → project (webhook configs)
                     │  X-Hub-Signature-256 against env[secret_env] (constant-time)
                     │  event filter · replay guard (last 100 delivery ids)
                     ▼  202 { delivery_id, project_id, dispatched: true }
               QueuedDispatcher                      (serial per project)
                     ▼
               SpawnRunner: materialize revision artifacts → temp workspace
                     ├─ spawn engine CLI (`site-docs run --workspace <dir>`)
                     ├─ append run-history row
                     ▼
               output strategy: pr-comment │ viewer-refresh │ wiki-push
```

### Webhook config

`GET`/`PUT /v1/workspaces/:ws/projects/:project/webhook-config` (bearer-auth'd, validated):

| Field           | Type / values                                   | Default                    | Meaning                                                          |
| --------------- | ----------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `repo`          | `"owner/name"`                                  | — (required)               | GitHub repository this project documents                         |
| `events`        | array of `push` \| `pull_request`               | — (required)               | deliveries outside this set are acknowledged (200) and ignored   |
| `strategy`      | `pr-comment` \| `viewer-refresh` \| `wiki-push` | — (required)               | where run output goes                                            |
| `workspace_rev` | `"head"` or a revision id                       | `"head"`                   | revision whose artifacts the run executes against                |
| `secret_env`    | env-var name                                    | `SITE_DOCS_WEBHOOK_SECRET` | which env var holds the HMAC secret (the secret is never stored) |
| `enabled`       | boolean                                         | `true`                     | disabled configs acknowledge deliveries without dispatching      |
| `plugin`        | `"<ns>:<name>"`                                 | —                          | publisher plugin (required for `wiki-push`)                      |
| `plugin_config` | object                                          | —                          | handed to the publisher; `sources: [<dir>]` names plugin paths   |

### Webhook endpoint behavior

`POST /v1/github/webhook` — unauthenticated route, strictly verified:

- **401** missing/invalid `X-Hub-Signature-256`, or the configured secret env var is unset (fails closed).
- **404** the payload's `repository.full_name` maps to no configured project.
- **400** unparsable payload, missing `repository.full_name`, or missing `X-GitHub-Delivery`.
- **200** `{ dispatched: false, reason }` for filtered events / disabled configs; `{ duplicate: true }` for replayed delivery ids (last 100 remembered, store-backed).
- **202** `{ delivery_id, project_id, dispatched: true }` — job queued; execution happens after the response, serialized per project.

### Output strategies

- **`pr-comment`** — posts the run summary via GitHub REST: an issue-comment on the PR (`pull_request` events) or a commit comment on the pushed head commit. Token: injected `tokenProvider` (installation-token wiring) or `GITHUB_APP_TOKEN` env.
- **`viewer-refresh`** — re-renders the viewer (`site-docs render`) from the materialized workspace and records `index.html` as a content-addressed blob.
- **`wiki-push`** — loads the configured publisher plugin with the engine's plugin contract (`docsxai` manifest in the plugin's `package.json` + `register(api)` module) from `plugin_config.sources` dirs (or `path:` entries in the workspace's `site-docs.config.json`) and reports its `PublishResult` into the run-history summary.

The engine CLI is resolved like the engine resolves its viewer bin: `SITE_DOCS_ENGINE_BIN` env override → the installed `@kalebtec/docsxai-engine` package's `site-docs` bin → `site-docs` on `PATH`.

### Owner-gated checklist (App registration)

Everything below requires owner credentials / a public URL and is **deliberately not automated**:

- [ ] Register the GitHub App (org settings → Developer settings → GitHub Apps); permissions: Contents read, Pull requests write, Metadata read; subscribe to `push` + `pull_request`.
- [ ] Set the App's webhook URL to the deployed backend's `https://<host>/v1/github/webhook`.
- [ ] Generate a webhook secret; export it as `SITE_DOCS_WEBHOOK_SECRET` (or the name in each project's `secret_env`) on the backend host.
- [ ] Wire installation tokens: exchange the App's private key for installation tokens and inject a `tokenProvider` (or export a `GITHUB_APP_TOKEN` for single-installation setups).
- [ ] Install the App on the documented repositories, then `PUT` each project's webhook config.

## Environment variables

| Variable                       | Effect                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `SITE_DOCS_DATA_DIR`           | persist to this directory via `FsStore` (the `--data-dir=` flag / `dataDir` option take precedence)          |
| `SITE_DOCS_TOKEN`              | the pre-issued CI bearer token; also the credential that auto-approves OAuth authorize requests              |
| `SITE_DOCS_OAUTH_AUTO_APPROVE` | `1` auto-approves OAuth authorize requests without a bearer (local dev / tests)                              |
| `SITE_DOCS_CACHE_KEY`          | client-side only — the base64 32-byte AES-256-GCM key for the auth-cache relay (the server never reads this) |
| `SITE_DOCS_WEBHOOK_SECRET`     | default GitHub webhook HMAC secret (per-project override via the config's `secret_env`)                      |
| `SITE_DOCS_ENGINE_BIN`         | explicit path to the engine CLI the webhook runner spawns                                                    |
| `GITHUB_APP_TOKEN`             | GitHub token for the `pr-comment` strategy when no `tokenProvider` is injected                               |
| `PORT`                         | bin default port (flag `--port=` wins)                                                                       |

Design: `projects/automated-site-documentation-bot/spec.md` in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio.

## License

[Apache-2.0](../../LICENSE).
