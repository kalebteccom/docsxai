# Auth catalogue + masking — per-strategy secret handling

Read this before touching anything under `packages/engine/src/auth/` or any
new egress path (publisher plugins, backend relay, webhook strategies).

## The invariants (every strategy, no exceptions)

- Descriptors (`auth/strategy.yaml`) carry env-var **names**, never values.
  Values are read at authenticate-time and exist only in process memory.
- Secret values never appear in: log lines, error messages (mask as `<SET>` /
  `<UNSET>` or the env-var name), halt context, diagnose output, doc-pack
  artifacts, committed fixtures, or test snapshots.
- `storageState` lands only under `.auth/` (gitignored, chokepointed via
  `resolveWorkspacePathReal`) or — for `store: backend` — inside an
  AES-256-GCM envelope encrypted **client-side** (`BackendStateCache`,
  key from `DOCSX_CACHE_KEY`); the backend stores ciphertext it cannot
  read.
- Masking happens **before** any persistence or serialization, not after —
  the sink applies the mask, then writes. New egress surfaces copy the
  browxai `<SECRET_NAME>` substitution norm (see the Confluence publisher's
  `<CONFLUENCE_TOKEN>` masking + its order-verifying test).

## Per-strategy secret surface

| Strategy                             | Secrets in flight                              | Residue to guard                                         |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------------------------- |
| `api-login`                          | username/password in a login POST              | Set-Cookie values in the jar → storageState only         |
| `jwt-injection`                      | client credentials or a static token           | the minted JWT (decode-don't-log; `exp` only)            |
| `ui-form`                            | creds typed into the page                      | screenshots are NOT taken during auth strategies         |
| `email-otp`                          | inbox endpoint + one-time code                 | message bodies (extract the code, drop the body)         |
| `totp`                               | the base32 seed                                | never print the seed or the computed code                |
| `webauthn`                           | virtual-authenticator key material (CDP-local) | nothing leaves the browser process                       |
| `http-basic` / `pat-header` / `mtls` | connection-level creds                         | `contextOptions` must never be serialized into artifacts |
| `test-backdoor`                      | the shared backdoor secret                     | the POST body (mask in any error)                        |
| `manual-capture`                     | the operator's live session                    | stays on the operator's machine unless `store: backend`  |

## Review checklist for a new strategy or egress path

1. Creds enter via `creds_env` names; `resolveCreds` handles pools.
2. Every error path masks; add the masking test alongside the happy path.
3. `expiresAt` derived when credible (cookie expiry / JWT `exp` / `expires_in`).
4. Fixture servers bind 127.0.0.1 and use obviously-fake values.
5. If the path leaves the machine (publisher, backend, webhook): the
   capability/secret is declared (plugin manifest `egress:` / documented env
   var), and the masking-before-write order has a test.
