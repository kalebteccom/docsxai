---
title: Auth strategies
description: The full eleven-strategy catalogue for getting docsxai through your app's login - per-strategy options, creds_env keys, expiry behavior, user pools for parallel workers, and the local and backend session caches.
---

Every auth strategy reduces to the same artifact: a `storageState` (cookies
plus localStorage) the runtime seeds the browser context with, optionally
plus connection-level context options (`httpCredentials`,
`extraHTTPHeaders`, `clientCertificates`). Because everything reduces to that
one shape, the rest of the suite stays auth-agnostic - `run` neither knows
nor cares how the session was obtained.

Three cross-cutting contracts:

- **Secrets stay out of band.** `creds_env` maps credential _keys to env-var
  names_, never values. Error messages mask values as `<SET>` / `<UNSET>` and
  never echo them; nothing secret lands in the descriptor or the artifacts.
- **`expiresAt` when derivable.** A strategy reports a hard expiry when it
  can know one (the named or lone real-expiry cookie, the JWT `exp` claim,
  the token endpoint's `expires_in`); otherwise the cache's `auth_cookie` /
  `ttl` rules take over (see [caching](#the-session-cache)).
- **User pools.** Any credential env value may be comma-separated
  (`u1,u2,u3`); parallel worker N consistently picks entry `N % len` across
  every pooled variable, so `run --concurrency` can give each worker its own
  account.

## The descriptor

Roles are declared in `<workspace>/auth/strategy.yaml`
(schema `docsxai/auth-strategy@1`). Env-var names only:

```yaml
schema: docsxai/auth-strategy@1
default_role: editor
roles:
  editor:
    strategy: ui-form
    creds_env:
      username: MYAPP_EDITOR_USER # names of env vars, never values
      password: MYAPP_EDITOR_PASSWORD
    options:
      login_url: /login
      username_selector: '[name="email"]'
      password_selector: '[name="password"]'
      submit_selector: 'button[type="submit"]'
      success_selector: '[data-testid="nav-account"]'
    cache:
      enabled: true
      store: local
      ttl: 1h
      auth_cookie: session # pin expiry to the app's real session cookie
  admin:
    strategy: manual-capture
    options:
      capture_trigger: console
```

## The catalogue

### `manual-capture`

The zero-integration universal fallback for SSO, MFA, and conditional
access. `docsxai capture-auth` opens an instrumented, headed Chrome; the
human logs in however they normally do, then triggers capture
(`window.__docsxai.capture()` in the console, or an injected button with
`capture_trigger: button`). Options: `capture_trigger: console|button`. No
`creds_env`. Deliberately reports no `expiresAt`: an interactive SSO login
drops ephemeral IdP scratch cookies whose expiry is seconds out, so the
minimum-cookie heuristic would make the session born expired - pin
`cache.auth_cookie` instead. Cost: periodic human re-capture.

```yaml
roles:
  admin:
    strategy: manual-capture
    options:
      capture_trigger: button # injected on-page button instead of the console call
    cache:
      enabled: true
      store: local
      auth_cookie: session
```

### `api-login`

POST the role's credentials to the app's login endpoint over plain HTTP and
keep the cookies collected across the redirect chain. No browser. Options:
`login_url`, `method` (default `POST`), `body_format: json|form` (default
`json`), and `success_check` - one of `{ cookie }` (the jar must contain it),
`{ status }` (final status must equal it), or `{ json_path, equals }`
(dotted-path JSON check); default is final status below 400. `creds_env`:
`username`, `password`. `expiresAt` comes from the named or lone
real-expiry cookie in the jar when derivable.

```yaml
roles:
  editor:
    strategy: api-login
    creds_env:
      username: MYAPP_USER # env-var names, never values
      password: MYAPP_PASSWORD
    options:
      login_url: /api/login
      body_format: json
      success_check: { cookie: session }
    cache: { enabled: true, auth_cookie: session }
```

### `ui-form`

Drive the app's own login form in headless Chromium: fill, submit, wait for
the logged-in marker, snapshot. Options: `login_url`, `username_selector`,
`password_selector`, `submit_selector`, one of `success_selector` or
`url_matches` (required), `timeout_ms` (default 15000),
`ignore_https_errors`, `pre_steps` (click/fill steps that dismiss cookie
banners and similar pre-login chrome; fill values come from env vars via
`value_env`), and `totp` (below). `creds_env`: `username`, `password`.
`expiresAt` from the cookie jar when derivable.

### `totp`

Not a standalone scheme - a one-time code is one _field_ of an interactive
login - so the catalogue entry composes `ui-form`: set `options.totp` there.
Options: `totp: { secret_env, otp_selector, submit_selector?, digits?
(6 or 8), period? (default 30), algorithm? (sha1|sha256) }`. The RFC 6238
code is generated dep-free with `node:crypto` from the base32 secret in
`secret_env` and filled after the password submit.

```yaml
roles:
  editor:
    strategy: ui-form
    creds_env:
      username: MYAPP_USER
      password: MYAPP_PASSWORD
    options:
      login_url: /login
      username_selector: '[name="email"]'
      password_selector: '[name="password"]'
      submit_selector: 'button[type="submit"]'
      success_selector: '[data-testid="nav-account"]'
      totp:
        secret_env: MYAPP_TOTP_SECRET # base32 secret, env-var name only
        otp_selector: '[name="one-time-code"]'
```

### `email-otp`

A `ui-form` login whose second factor arrives by mail: an inbox provider
polls for the code mail, a regex extracts the code, the strategy submits it.
Options: the `ui-form` form fields plus `otp_selector`,
`otp_submit_selector?`, and `inbox: { provider (default http-json), options:
{ url, poll_interval_ms? }, to_env?, code_pattern? (default \b(\d{6})\b),
timeout_ms? (default 30000) }`. The built-in `http-json` provider polls a
Mailpit-style `{ messages: [{ to, received_at, body }] }` endpoint; other
inbox shapes register via `registerInboxProvider(name, factory)` - also a
plugin hook. `creds_env`: `username`, `password`. The watched address
defaults to the `username` credential unless `to_env` names another var.

```yaml
roles:
  editor:
    strategy: email-otp
    creds_env:
      username: MYAPP_USER
      password: MYAPP_PASSWORD
    options:
      login_url: /login
      username_selector: '[name="email"]'
      password_selector: '[name="password"]'
      submit_selector: 'button[type="submit"]'
      success_selector: '[data-testid="nav-account"]'
      otp_selector: '[name="code"]'
      inbox:
        provider: http-json
        options: { url: "http://localhost:8025/api/v1/messages" } # Mailpit-style endpoint
```

### `webauthn`

Passkey login through a CDP virtual authenticator (ctap2, internal,
user-verifying, automatic presence simulation - the standard headless-CI
stand-in for platform authenticators). The authenticator is attached
_before_ navigation so the login page's first feature probe sees it.
Options: `login_url`, `trigger_selector` (the "sign in with a passkey"
control), `username_selector?` (username-first flows), one of
`success_selector` or `url_matches`, `timeout_ms`, `ignore_https_errors`,
`pre_steps`. `creds_env`: `username` (username-first flows only).

```yaml
roles:
  editor:
    strategy: webauthn
    creds_env:
      username: MYAPP_USER # username-first flows only
    options:
      login_url: /login
      username_selector: '[name="email"]'
      trigger_selector: '[data-testid="use-passkey"]'
      success_selector: '[data-testid="nav-account"]'
```

### `jwt-injection`

Obtain a bearer token and inject it into the browser's storage the way the
target SPA expects. No browser needed to authenticate. Token source: exactly
one of `token_env` (a static token in an env var) or `token_url` (an OAuth2
client-credentials mint; `creds_env`: `client_id`, `client_secret`).
Injection: `inject: { localStorage: [{ key, value_template }], cookies:
[{ name, value_template, domain?, path? }] }` with `{{token}}` templates
(default template is the bare token). `expiresAt` from the token endpoint's
`expires_in`, falling back to the JWT's own `exp` claim.

```yaml
roles:
  service:
    strategy: jwt-injection
    creds_env:
      client_id: MYAPP_CLIENT_ID # only with token_url (client-credentials mint)
      client_secret: MYAPP_CLIENT_SECRET
    options:
      token_url: /oauth/token
      inject:
        localStorage:
          - { key: "auth.token", value_template: "{{token}}" }
```

### `http-basic`

Connection-level HTTP Basic: the browser context answers 401 challenges with
the role's credentials via Playwright `httpCredentials`. No options.
`creds_env`: `username`, `password`. Nothing to capture and nothing to
expire - the storageState is empty and the credentials ride along on every
context.

```yaml
roles:
  editor:
    strategy: http-basic
    creds_env:
      username: MYAPP_USER
      password: MYAPP_PASSWORD
```

### `pat-header`

A static personal-access-token header on every request via
`extraHTTPHeaders`. Options: `header` (default `Authorization`) and
`value_template` (default `Bearer {{token}}`). `creds_env`: `token`. Like
`http-basic`, connection-level: empty storageState, no expiry.

```yaml
roles:
  service:
    strategy: pat-header
    creds_env:
      token: MYAPP_API_TOKEN
    options:
      header: X-Api-Key
      value_template: "{{token}}"
```

### `mtls`

Client-certificate auth via Playwright `clientCertificates`. Options:
`origin?` (default: the base URL's origin). `creds_env`: `cert` and `key`
hold _paths_ to PEM files (the bytes stay on disk and never enter logs), plus
optional `passphrase` for an encrypted key. Connection-level: empty
storageState, no expiry.

```yaml
roles:
  service:
    strategy: mtls
    creds_env:
      cert: MYAPP_CLIENT_CERT_PATH # env vars holding *paths* to PEM files
      key: MYAPP_CLIENT_KEY_PATH
```

### `test-backdoor`

POST a shared secret to a test-only login endpoint the app exposes in
non-production builds, and keep the session cookies it sets. The
unattended-execution answer when the app team can ship a backdoor route.
Options: `url`, `user_id?` (sent verbatim in the body), `success_cookie?`
(the cookie that proves it worked; without it, any Set-Cookie plus a non-4xx
passes). `creds_env`: `secret`. `expiresAt` from the success cookie's expiry
when derivable.

```yaml
roles:
  ci:
    strategy: test-backdoor
    creds_env:
      secret: MYAPP_BACKDOOR_SECRET
    options:
      url: /__test__/login
      user_id: docs-bot
      success_cookie: session
```

## The session cache

The `cache` block on each role controls reuse:

- `enabled` - cache at all (default false).
- `store: local` (default) caches to `<workspace>/.auth/<role>.json`.
  Operator-local, gitignored.
- `store: backend` relays a client-side-encrypted AES-256-GCM envelope
  through the backend so a team can share captured sessions. The encryption
  key comes from `DOCSX_CACHE_KEY` (a base64 32-byte key) and never
  leaves the client - the backend stores ciphertext it cannot read. Needs a
  backend-bound workspace (`docsxai push` first).
- `ttl` - the fallback expiry: a duration (`30m`, `1h`, milliseconds) or
  `session`.
- `auth_cookie` - the name of the app's real session cookie. When set, the
  cached session's expiry is _that cookie's_ expiry - the true bound - rather
  than the `ttl` guess.

Expiry is computed in priority order: the named auth cookie's expiry if it is
in the captured jar with a real (non-session) expiry; else `ttl` from now;
else the strategy's reported `expiresAt` if plausibly in the future; else one
hour. A computed expiry in the past refuses to cache - you never cache a dead
session. `capture-auth` prints which source the expiry came from; confirm it
says your auth cookie.

Plugins can add schemes or replace a built-in via
`registerAuthStrategy(name, impl)`, consulted before the built-ins - see
[Writing plugins](/guides/writing-plugins/). For the workflow around all of
this (identifying the right cookie, the shared-CDP single-login setup), see
the [agent runbook](/guides/agent-runbook/).
