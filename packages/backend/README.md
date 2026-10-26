# @docsxai/backend

Authenticated service that persists doc packs (projects, revisions, flow-files, screenshots, annotations, style artifacts, run history). REST + per-resource endpoints; OAuth 2.1 (authorization-code + PKCE) plus a pre-issued CI bearer token; content-addressed blob storage; immutable finalized revisions.

**Status:** storage is in-memory by default and filesystem-backed with a data dir. There is no hosted multi-tenant deployment (interactive consent, durable token store, database).

## Surface

- **`ROUTES`** in `src/api.ts` — the canonical endpoint list. `/v1/workspaces/{ws}/projects/{p}/revisions/{rev}/{flows|annotations|screenshots|style|locators}`, plus run history, blobs, the auth-cache relay, and the OAuth endpoints. Versioned via the `Docsxai-Api-Version` header.
- **Linear immutable revisions** — every `calibrate` / `run` / human edit creates a new revision with `id` / `parent_revision_id` / `kind` / `author` / `created_at`. No branches; concurrent-edit conflicts surface as failed pushes resolved via re-pull + re-edit.
- **`createBackendStub({ token?, store?, dataDir? })`** — starts the server bound to loopback; used by the engine's integration tests and as the local dev backend.
- **`docsxai-backend`** bin — the same server as a standalone process: `docsxai-backend --port=4477 --data-dir=~/.docsxai-data` (`--port 4477` works too). A missing flag value, a port outside 0-65535 or an unknown argument exits 2 with a usage line; a port already in use or an unusable data dir exits 1 with one line naming it.

## Persistence modes

| Mode                    | Selection                                                 | Layout                         |
| ----------------------- | --------------------------------------------------------- | ------------------------------ |
| `MemoryStore` (default) | no `dataDir`, no `DOCSX_DATA_DIR`                         | per-process, resets on restart |
| `FsStore`               | `dataDir` option, `--data-dir=` flag, or `DOCSX_DATA_DIR` | see below                      |
| custom                  | pass any `BackendStore` implementation via `store`        | yours                          |

`FsStore` layout under the data dir:

```
workspaces.json
projects/<projectId>/meta.json
projects/<projectId>/runs.json
projects/<projectId>/revisions/<revId>/meta.json
projects/<projectId>/revisions/<revId>/artifacts/<slot>.json
projects/<projectId>/webhook-config.json
blobs/<sha256>            ← content-addressed, shared across revisions
auth-cache/<wsId>/<role>.json
webhook-deliveries.json   ← replay guard: last 100 delivery ids
```

Each project keeps its newest 1000 run-history records (`RUN_HISTORY_LIMIT`); appending past that drops the oldest. A webhook run records the revision it executed against, not a `head` that moved while it ran, and a job whose workspace could not be laid out appends a failed record with the reason. Writes are atomic (tmp file + rename); reads always go to disk, so multiple processes pointed at one data dir stay consistent. Every path join is containment-guarded against the data root — traversal-shaped ids read as not-found and traversal-shaped writes throw. `FsStore` and `MemoryStore` list projects in creation order, and a webhook picks the first project whose `repo` matches in that order. A request target the URL parser rejects (`GET //`, `GET //[`) gets `400 bad_request`.

## Blob protocol

Binary artifacts (screenshots) never travel as base64-in-JSON. The flow:

1. `POST /v1/blobs` with the raw bytes (≤ 25 MB) → `{ sha256, bytes }`. Idempotent — the server computes the hash; re-posting the same bytes is a no-op.
2. `HEAD /v1/blobs/:sha256` → 200/404, so clients skip uploads for bytes the backend already has (`docsxai push` HEAD-probes before every upload).
3. The `screenshots` artifact slot carries a manifest, not bytes: `{ schema: "docsxai/screenshots@2", files: { "<flow>/screenshots/<file>.png": { sha256, bytes } } }`.
4. `GET /v1/blobs/:sha256` returns the raw bytes; pulls fetch the manifest, then the blobs, and verify each against its hash.

Blobs are deduplicated across revisions and projects — an unchanged screenshot costs one HEAD per push.

## Revision finalization

`POST .../revisions/:rev/finalize` marks a revision immutable (idempotent; `GET` reflects `finalized: true`). Artifact `PUT`s on a finalized revision are rejected with **409** `{ "error": "revision-finalized" }`. `docsxai push` finalizes after uploading all artifacts, so a pushed revision is a sealed snapshot; new revisions are unaffected.

## Auth

Two ways through the bearer gate (everything except `/v1/health` and the OAuth endpoints):

- **CI token** — start the server with `DOCSX_TOKEN` set (or the `token` option); callers present it as `Authorization: Bearer <token>`. If no token is configured the stub accepts any non-empty bearer.
- **OAuth 2.1 access token** — issued by the built-in authorization server, below.

Failed auth → **401** with a `WWW-Authenticate: Bearer` header.

### OAuth 2.1 + PKCE endpoints

The backend is its own minimal authorization server:

- `GET /v1/oauth/authorize?client_id=docsxai-cli&code_challenge=<S256>&code_challenge_method=S256&redirect_uri=http://127.0.0.1:<port>/callback&state=…` → **302** to the redirect URI with `code` + `state`. Codes are single-use, 5-minute TTL, bound to the challenge + redirect URI. Only loopback redirect URIs are accepted; only `S256`.
- `POST /v1/oauth/token` (form-encoded) — `grant_type=authorization_code` (+ `code`, `code_verifier`) → `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`; `grant_type=refresh_token` rotates (the presented refresh token is invalidated). A refresh token expires 30 days after it was issued; set `DOCSX_OAUTH_REFRESH_TTL_DAYS` to change that. A client idle for longer runs `docsxai login` again.

Consent is stub-grade by design: the authorize request is auto-approved when it carries `Authorization: Bearer <DOCSX_TOKEN>` **or** when `DOCSX_OAUTH_AUTO_APPROVE=1`. There is no interactive consent page: without either, the authorize request answers 403 `consent_required` and the message tells the user to ask whoever runs the server. Tokens are random 32-byte values; the server stores only their sha256 hashes (with expiry + workspace scope; `null` scope = all workspaces, matching today's stub semantics). Issued tokens live in process memory — they don't survive a restart; the CI-token path does.

`docsxai login --backend-url <url> --oauth <workspace>` drives the full handshake from the CLI and stores the tokens at `<workspace>/.auth/backend-token.json` (mode 0600).

## Auth-cache relay (zero-knowledge)

`PUT` / `GET` / `DELETE` `/v1/workspaces/:ws/auth-cache/:role` relays a **client-side-encrypted** storage-state envelope so a team can share captured target-site sessions through the backend:

```json
{
  "schema": "docsxai/auth-cache@1",
  "alg": "aes-256-gcm",
  "iv": "…",
  "ciphertext": "…",
  "tag": "…",
  "expires_at": 1750000000000
}
```

The backend validates the envelope shape and stores it opaquely — **it never sees the plaintext session**. Encryption happens in the engine (`BackendStateCache` in `@docsxai/engine`) with a 32-byte key from `DOCSX_CACHE_KEY` that never leaves the client. Malformed envelopes → 400; `DELETE` is idempotent.

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

```text wrap=false
GitHub push/PR ──▶ POST /v1/github/webhook          (no bearer auth; HMAC-verified)
                     │  repo → project (webhook configs)
                     │  X-Hub-Signature-256 against env[secret_env] (constant-time)
                     │  event filter · replay guard (last 100 delivery ids)
                     ▼  202 { delivery_id, project_id, dispatched: true }
               QueuedDispatcher                      (serial per project)
                     ▼
               SpawnRunner: materialize revision artifacts → temp workspace
                     ├─ spawn engine CLI (`docsxai run <dir>`)
                     ├─ append run-history row
                     ▼
               output strategy: pr-comment │ viewer-refresh │ wiki-push
```

### Webhook config

`GET`/`PUT /v1/workspaces/:ws/projects/:project/webhook-config` (bearer-auth'd, validated):

| Field           | Type / values                                   | Default                | Meaning                                                          |
| --------------- | ----------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| `repo`          | `"owner/name"`                                  | — (required)           | GitHub repository this project documents                         |
| `events`        | array of `push` \| `pull_request`               | — (required)           | deliveries outside this set are acknowledged (200) and ignored   |
| `strategy`      | `pr-comment` \| `viewer-refresh` \| `wiki-push` | — (required)           | where run output goes                                            |
| `workspace_rev` | `"head"` or a revision id                       | `"head"`               | revision whose artifacts the run executes against                |
| `secret_env`    | `DOCSX_WEBHOOK_SECRET[_<SUFFIX>]`               | `DOCSX_WEBHOOK_SECRET` | which env var holds the HMAC secret (the secret is never stored) |
| `enabled`       | boolean                                         | `true`                 | disabled configs acknowledge deliveries without dispatching      |
| `plugin`        | `"<ns>:<name>"`                                 | —                      | publisher plugin (required for `wiki-push`)                      |
| `plugin_config` | object                                          | —                      | handed to the publisher; no `sources`, URL keys are allowlisted  |

`secret_env` must be `DOCSX_WEBHOOK_SECRET` or `DOCSX_WEBHOOK_SECRET_<SUFFIX>` (`A-Z`, `0-9`, `_`), so a config can't key the HMAC on a server variable whose value a caller knows, such as `DOCSX_TOKEN` or `HOME`. Any other name gets `400 bad_request` naming `secret_env`, and a config stored before this rule answers every delivery with 401.

`plugin_config` is checked against the backend's environment on `PUT` (`400 bad_request` naming the field) and again when a `wiki-push` run starts (the run fails with the same message):

- `sources` is refused. Publisher directories come from `DOCSX_BACKEND_PLUGIN_DIRS`.
- Every key named `url` or ending in `_url` (`base_url`, `graph_base_url`) must be an `https:` URL without credentials whose origin is listed in `DOCSX_BACKEND_PUBLISHER_ORIGINS`. With the variable unset, every such key is refused. A publisher's default URL, used when the key is absent, is not checked here.

### Upgrading a stored wiki-push config

A `wiki-push` config written before these checks keeps working only after the backend's environment names what the config used to name. Three things move.

Before, stored with `PUT .../webhook-config`:

```json
{
  "repo": "acme/web-app",
  "events": ["push"],
  "strategy": "wiki-push",
  "plugin": "confluence:push",
  "secret_env": "ACME_WEBHOOK_SECRET",
  "plugin_config": {
    "sources": ["/opt/docsxai/plugins/confluence"],
    "base_url": "https://acme.atlassian.net",
    "space_key": "DOCS"
  }
}
```

After, the same config:

```json
{
  "repo": "acme/web-app",
  "events": ["push"],
  "strategy": "wiki-push",
  "plugin": "confluence:push",
  "secret_env": "DOCSX_WEBHOOK_SECRET_ACME",
  "plugin_config": {
    "base_url": "https://acme.atlassian.net",
    "space_key": "DOCS"
  }
}
```

And on the backend host:

```sh
export DOCSX_BACKEND_PLUGIN_DIRS=/opt/docsxai/plugins/confluence
export DOCSX_BACKEND_PUBLISHER_ORIGINS=https://acme.atlassian.net
export DOCSX_BACKEND_PUBLISHER_ENV=CONFLUENCE_TOKEN
# the HMAC secret moves from ACME_WEBHOOK_SECRET to the new name; same value
export DOCSX_WEBHOOK_SECRET_ACME=...
```

- `plugin_config.sources` is removed and its directories go in `DOCSX_BACKEND_PLUGIN_DIRS` as absolute paths. While the key stays in the stored config, every run fails and a new `PUT` gets 400.
- Each `base_url` (or other `*_url` key) keeps its place in `plugin_config`, and its origin is added to `DOCSX_BACKEND_PUBLISHER_ORIGINS`. Without the entry the run fails naming the key.
- A custom `secret_env` is renamed to `DOCSX_WEBHOOK_SECRET_<SUFFIX>`, in the config and on the host. Until both match, every delivery for that project gets 401. Update the secret in the GitHub App's webhook settings only if you change its value.
- A publisher that read credentials through `secretsEnv` now sees only the variables in `DOCSX_BACKEND_PUBLISHER_ENV`. List the variables it needs there.

Refresh tokens issued before this change expire 30 days after they were issued, so a CLI idle for longer than that runs `docsxai login` again.

### Webhook endpoint behavior

`POST /v1/github/webhook` — unauthenticated route, strictly verified:

- **401** missing/invalid `X-Hub-Signature-256`, the configured secret env var is unset (fails closed), the payload is unparsable or has no `repository.full_name`, or the repository maps to no configured project. All of these return the same body, so the route doesn't say which repositories the backend serves. The repository match ignores case, because GitHub does (`Acme/Docs` finds a project configured as `acme/docs`).
- **400** missing `X-GitHub-Delivery` on a correctly signed delivery.
- **200** `{ dispatched: false, reason }` for filtered events / disabled configs; `{ duplicate: true }` for replayed delivery ids (last 100 remembered, store-backed).
- **202** `{ delivery_id, project_id, dispatched: true }` — job queued; execution happens after the response, serialized per project.

### Output strategies

- **`pr-comment`** — posts the run summary via GitHub REST: an issue-comment on the PR (`pull_request` events) or a commit comment on the pushed head commit. Token: injected `tokenProvider` (installation-token wiring) or `GITHUB_APP_TOKEN` env.
- **`viewer-refresh`** — re-renders the viewer (`docsxai render`) from the materialized workspace and records `index.html` as a content-addressed blob.
- **`wiki-push`** — loads publisher plugins with the engine's plugin contract (`docsxai` manifest in the plugin's `package.json` + `register(api)` module) from the directories in `DOCSX_BACKEND_PLUGIN_DIRS`, calls the one named by `plugin` and reports its `PublishResult` into the run-history summary. The list is absolute paths separated by `:` (`;` on Windows); a relative entry, or a `register` module whose real path leaves its directory, fails the run. Nothing in the webhook config or the materialised workspace names a directory, and `path:` entries in a workspace `docsxai.config.json` are ignored. Publisher code runs in the backend process, so list only plugins you trust. The publisher's `secretsEnv` holds only the variables named in `DOCSX_BACKEND_PUBLISHER_ENV` (empty when unset); the bundled publishers read their credentials (`CONFLUENCE_TOKEN`, `NOTION_TOKEN`, ...) from the process environment themselves.

The materialized workspace has the layout `pull` writes: `flows/<name>.flow.yaml`, `docs/<flow>[/<variant>]/{annotations.json, screenshots/}`, `docs/{style.yaml, style.json, locators.yaml}` and `.docsxai.json` (with `app_url` from the project record when it has one), plus `webhook-job.json`. A file name outside what a workspace produces fails the job before the engine starts. The failed run in run history names the refused file; any other failure to lay out the workspace is recorded as `server file system error`, with no server path.

### Project `app_url` host rules

`app_url` is validated when it is set (`POST`/`PUT` on a project: `400 bad_request` naming `app_url`) and again when a webhook run writes it to `.docsxai.json`, which fails the job. The host is checked as written, after the URL parser has normalised decimal, hex and octal IPv4 forms, IPv4-mapped IPv6 and a trailing dot. A link-local or cloud-metadata host is always refused (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `100.100.100.200`, `168.63.129.16`, `metadata.google.internal`, `instance-data`, and an IPv6 address that embeds one through IPv4-mapping, NAT64, 6to4 or Teredo), because a run screenshots whatever `app_url` names. Loopback and private-network hosts are allowed by default; set `DOCSX_BACKEND_DENY_PRIVATE_APP_URL` to `1`, `true` or `yes` (any case) on the backend to refuse those too (`0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `::`, `::1`, `fc00::/7`, `fec0::/10`, `64:ff9b:1::/48`, and the names `localhost`, `localhost.localdomain`, `ip6-localhost`, `ip6-loopback` and `*.localhost`). Any other non-empty value leaves the switch off, and `docsxai doctor` warns about it. A DNS name is not resolved by this check, so a name that points at a refused address is not caught here; the engine's request guard (below) resolves names.

### Flow `navigate` and `upload` values

Materialising a revision parses every `flows/*.flow.yaml` and refuses one whose `navigate` step value resolves to an absolute URL that fails the `app_url` host rules, or, when the project has an `app_url`, to one outside its origin. Relative values (`/checkout`, `?tab=1`) stay inside the base URL and pass; `//host/x` and `/\host` do not, because the URL parser reads them as another host. An `upload` step's value must be a relative path with no `..` segment (the engine's driver also confines it to the workspace at run time). A flow file that is not valid YAML fails too. The job fails before the engine starts.

### Engine request guard

The runner starts every webhook run's engine with `DOCSX_EGRESS_GUARD=1`, which makes `@docsxai/engine` check each browser request, redirect hops included, against the same address rules: a host that is, or resolves to, a link-local or metadata address is aborted, and so is a request whose lookup fails; WebSocket connections get the same check. A refusal prints only `address not allowed` and the URL without userinfo or query. It adds `DOCSX_EGRESS_DENY_PRIVATE=1` when the backend's `DOCSX_BACKEND_DENY_PRIVATE_APP_URL` is on. Set `DOCSX_EGRESS_GUARD=0` on the backend to start runs without the guard, and set `DOCSX_EGRESS_DENY_PRIVATE` yourself to override the private-range default. The guard resolves a name before the request and the browser resolves it again, so DNS rebinding still gets through: run the engine behind an egress firewall in a hosted deployment. See `SECURITY.md`.

The engine CLI is resolved like the engine resolves its viewer bin: `DOCSX_ENGINE_BIN` env override → the installed `@docsxai/engine` package's `docsxai` bin → `docsxai` on `PATH`.

### GitHub App registration checklist

Everything below needs admin rights on the GitHub org and a public URL for the backend, and is **deliberately not automated**:

- [ ] Register the GitHub App (org settings → Developer settings → GitHub Apps); permissions: Contents read, Pull requests write, Metadata read; subscribe to `push` + `pull_request`.
- [ ] Set the App's webhook URL to the deployed backend's `https://<host>/v1/github/webhook`.
- [ ] Generate a webhook secret; export it as `DOCSX_WEBHOOK_SECRET` (or the name in each project's `secret_env`) on the backend host.
- [ ] Wire installation tokens: exchange the App's private key for installation tokens and inject a `tokenProvider` (or export a `GITHUB_APP_TOKEN` for single-installation setups).
- [ ] Install the App on the documented repositories, then `PUT` each project's webhook config.

## Environment variables

| Variable                             | Effect                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `DOCSX_DATA_DIR`                     | persist to this directory via `FsStore` (the `--data-dir=` flag / `dataDir` option take precedence)                |
| `DOCSX_TOKEN`                        | the pre-issued CI bearer token; also the credential that auto-approves OAuth authorize requests                    |
| `DOCSX_OAUTH_AUTO_APPROVE`           | `1` auto-approves OAuth authorize requests without a bearer (local dev / tests)                                    |
| `DOCSX_CACHE_KEY`                    | client-side only — the base64 32-byte AES-256-GCM key for the auth-cache relay (the server never reads this)       |
| `DOCSX_BACKEND_DENY_PRIVATE_APP_URL` | `1`, `true` or `yes` also refuses loopback and private-network `app_url` hosts and flow `navigate` targets         |
| `DOCSX_EGRESS_GUARD`                 | passed to webhook runs as `1` unless set to `0`, `false` or `no`: the engine aborts requests to metadata addresses |
| `DOCSX_EGRESS_DENY_PRIVATE`          | passed to webhook runs as `1` when `DOCSX_BACKEND_DENY_PRIVATE_APP_URL` is on and this is unset                    |
| `DOCSX_WEBHOOK_SECRET`               | default GitHub webhook HMAC secret (per-project override via the config's `secret_env`)                            |
| `DOCSX_ENGINE_BIN`                   | explicit path to the engine CLI the webhook runner spawns                                                          |
| `DOCSX_BACKEND_PLUGIN_DIRS`          | absolute publisher plugin directories for `wiki-push`, separated by `:` (`;` on Windows)                           |
| `DOCSX_BACKEND_PUBLISHER_ORIGINS`    | comma-separated `https://` origins a `plugin_config` URL key may name; unset refuses every URL key                 |
| `DOCSX_BACKEND_PUBLISHER_ENV`        | comma-separated env var names passed to the publisher as `secretsEnv`; unset passes none                           |
| `DOCSX_OAUTH_REFRESH_TTL_DAYS`       | refresh-token lifetime in days, a positive number (default `30`); a bad value stops the server at start            |
| `GITHUB_APP_TOKEN`                   | GitHub token for the `pr-comment` strategy when no `tokenProvider` is injected                                     |
| `PORT`                               | bin default port (flag `--port=` wins)                                                                             |

## License

[Apache-2.0](../../LICENSE).
