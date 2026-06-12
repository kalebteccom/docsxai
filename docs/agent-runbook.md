# Agent runbook — run docsxai against an app repo, leaving no trace

> Hand this file to a coding agent. It tells the agent how to set up and run **docsxai** to document a
> running web app that's built/served from a local repo — **without modifying that repo**. docsxai operates
> _on_ the running app from outside; everything it produces lives in a separate workspace dir; the app itself
> is run from a throwaway git worktree so even its build scripts can't dirty the real checkout.

## Inputs the human gives you

Fill these in before starting:

```bash
export APP_REPO=…          # the source checkout of ANY web app you want to document. YOU MUST NOT MODIFY THIS.
export TOOL_REPO=…         # the docsxai repo (this repo: kalebteccom/docsxai)
export WORKSPACE=…         # where docsxai artifacts go — MUST be OUTSIDE $APP_REPO. e.g. ~/docsxai/<app-name>
export APP_RUN=/tmp/docsxai-app-run   # disposable copy of $APP_REPO that you'll actually run
# After step 2 you'll also know $APP_URL (the dev server's URL).
```

If the human only gave you `$APP_REPO`, pick sensible defaults for the others and tell them what you chose.

## Hard rules (the "no trace" contract)

1. **Never write any file inside `$APP_REPO`.** Not the doc pack, not config, not `.claude/`, nothing. All docsxai output → `$WORKSPACE` (which is outside `$APP_REPO`).
2. **Never `npm install` / `pnpm install` / build inside `$APP_REPO`.** Run the app from `$APP_RUN` (a disposable worktree); its `node_modules`/lockfile changes stay there.
3. **Never vendor the docsxai skill into `$APP_REPO/.claude/`.** Use the CLIs from `$TOOL_REPO` (and the Claude Code plugin if installed) — don't `vendorSkill` into the app repo.
4. **Don't put the captured login session in `$APP_REPO`.** `manual-capture` caches it to `$WORKSPACE/.auth/` (gitignored there); the backend never holds it (`store: local`).
5. **At the end, verify `git -C "$APP_REPO" status` is clean.** If it isn't, you violated rule 1 or 2 — investigate and revert.

## One-time: build the tool

```bash
cd "$TOOL_REPO"
corepack enable
pnpm install
pnpm -C packages/engine exec playwright-core install chromium
pnpm -r build
```

Make `docsxai` / `docsxai-viewer` callable. The robust way is two tiny wrapper scripts on your `PATH`:

```bash
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$TOOL_REPO" > "$HOME/.local/bin/docsxai"
printf '#!/usr/bin/env bash\nexec node "%s/packages/viewer/dist/index.js" "$@"\n' "$TOOL_REPO" > "$HOME/.local/bin/docsxai-viewer"
chmod +x "$HOME/.local/bin/docsxai" "$HOME/.local/bin/docsxai-viewer"
export PATH="$HOME/.local/bin:$PATH"
```

(`pnpm -C packages/{engine,viewer} link --global` also works _if_ your pnpm global store is consistent — it often isn't on a long-lived machine; `ERR_PNPM_UNEXPECTED_STORE` is fixed by `pnpm install --global pnpm`. The wrapper scripts above sidestep all of that.) Below assumes `docsxai` / `docsxai-viewer` are on `PATH`; equivalently call `node "$TOOL_REPO/packages/engine/dist/cli.js" …` etc. directly.

## Step 1 — scaffold the workspace (one command, with the config baked in)

```bash
docsxai init "$WORKSPACE" --app-url "$APP_URL_PLACEHOLDER" --ignore-https-errors --auth manual-capture --ttl 1h
```

(If you don't know `$APP_URL` yet, run `docsxai init "$WORKSPACE" --auth manual-capture --ttl 1h` now and add `app_url` to `$WORKSPACE/.docsxai.json` after step 2 — or just pass `--base-url` on later commands.)

This creates `$WORKSPACE/{flows,docs,auth,.auth,.viewer}`, a `.gitignore` (`.auth/`, `.viewer/`), `auth/strategy.yaml` (`manual-capture`, `store: local`, `ttl: 1h`), a `README.md`, and `.docsxai.json` (holds `app_url` + `ignore_https_errors`, so subsequent `run`/`capture-auth` need no flags). For a fully ephemeral workspace instead: `docsxai init --persist tmp …` (it prints the temp dir; `rm -rf` it when done).

## Step 2 — run the app from a disposable worktree

```bash
git -C "$APP_REPO" worktree add "$APP_RUN"          # throwaway worktree on the current commit
cd "$APP_RUN"
# Copy any GITIGNORED files the app needs to boot but that git didn't bring into the worktree —
# e.g. `.env` (build-time vars), a dev-cert dir (`.cert/`, `certs/`), local config. Reading them from
# $APP_REPO and copying into $APP_RUN is fine — it does not modify $APP_REPO. E.g.:
#   [ -f "$APP_REPO/.env" ] && cp "$APP_REPO/.env" .
#   [ -d "$APP_REPO/.cert" ] && cp -R "$APP_REPO/.cert" .
npm ci                                               # or pnpm/yarn — match the app's lockfile; touches $APP_RUN/node_modules only
npm run dev                                           # start the dev server (background it, or use a separate shell)
# read the URL/port the dev server ACTUALLY prints — it may differ from the default (e.g. Vite auto-picks
# 3001 if 3000 is taken). Then either pass --base-url <that-url> on capture-auth/run, or update the config:
export APP_URL="https://localhost:5173"               # ← the actual URL it printed (HTTPS if the repo ships a dev cert)
node -e "const f='$WORKSPACE/.docsxai.json',j=require(f);j.app_url='$APP_URL';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
```

(Alternatively `git clone --no-hardlinks "$APP_REPO" "$APP_RUN"`.)

## Step 3 — capture an authed session (if the app needs login)

```bash
docsxai capture-auth "$WORKSPACE"        # reads app_url + ignore_https_errors from .docsxai.json
```

An instrumented Chrome opens (headed). The **human** logs in interactively (SSO / MFA / conditional access — whatever they click through). When they're in, they run `window.__docsxai.capture()` in the devtools console (or click the injected "Capture session" button if `--capture-trigger button` was set). The session is cached to `$WORKSPACE/.auth/<role>.json`. **Tell the human these steps** — you can't log in for them. `capture-auth` keeps a persistent Chrome profile at `$WORKSPACE/.auth/chrome-profile/` (gitignored), so once they've logged in once, **re-running `capture-auth` reuses that session — usually they just trigger capture again, no re-login**. `--fresh` forces a clean profile.

`capture-auth` prints the captured cookie jar. **Identify the app's real auth/session cookie** and pin it so the cache tracks its actual expiry — otherwise the cache falls back to the `ttl` guess (which is what stops a freshly-captured SSO session from being "born expired": the jar has ephemeral IdP scratch cookies whose expiry is seconds out, so `min(cookie.expires)` ≈ now and must NOT be trusted — but `ttl` is still a guess; the real auth cookie's expiry is the true bound). The auth cookie is:

- on the **app's own domain** (e.g. `app.example.com` / `localhost:<port>` — _not_ the identity provider's domain: `login.microsoftonline.com`, `accounts.google.com`, `*.okta.com`, …),
- the **long-lived** one (latest expiry among app-domain cookies),
- typically named like `session` / `connect.sid` / `auth_token` / `JSESSIONID` / `_session_id`, or `.AspNetCore.Cookies` (any ASP.NET Core app — sometimes chunked into `…C1`/`…C2`) / `<AppName>Identity*` (an app's own identity cookie).

Then pin it (any of):

```bash
docsxai capture-auth "$WORKSPACE" --auth-cookie "<the-cookie-you-identified>"   # e.g. "session" / ".AspNetCore.Cookies"
#   or: edit $WORKSPACE/auth/strategy.yaml → roles.<role>.cache.auth_cookie: "<name>"  (then re-run capture-auth)
#   or: pass it up front:  docsxai init … --auth-cookie "<name>"
```

`capture-auth` reports `expires <ISO>  (from auth-cookie "<name>" | ttl | 1h default)` — confirm it says `auth-cookie "<name>"`. If `run` later says "session expired", re-run this step (re-login).

**Optional — one login, not two:** by default `capture-auth` launches its own instrumented Chrome, so the engineer logs in there _and_ (separately) in whatever browser the host agent uses for discovery (Step 4). To avoid the double login, have the engineer start a single Chrome that _both_ tools attach to. The clean way is **`browxai chrome start --insecure`** (owns the lifecycle, persistent profile at `$BROWX_WORKSPACE/chrome-profile/`, `--insecure` adds `--disable-web-security` for security-lowered dev targets); manual equivalent: `chrome --remote-debugging-port=9222 --disable-web-security --disable-features=IsolateOrigins,site-per-process --user-data-dir=/tmp/docsxai-chrome <app-url>`. Either way, the engineer logs in once, then `docsxai capture-auth "$WORKSPACE" --cdp http://localhost:9222` reads that browser's session (it won't close it), and Step 4's `browxai-attached` MCP entry drives discovery against the same Chrome.

> **Shared-CDP page-helper lifecycle.** When two clients share one `--cdp` Chrome and one disconnects, page-side helpers it injected can become stale. `window.__docsxai.capture()` detects the detached binding on next invocation, removes its injected button if any, logs `[docsxai] capture helper detached…`, and self-deletes from `window.__docsxai`. Reload the page or re-run `capture-auth` to install a fresh helper.

### Scripted re-auth — the auth-strategy catalogue

`manual-capture` (above) needs a human each time the session expires. For unattended re-auth (CI, scheduled runs), declare one of the scripted strategies in `$WORKSPACE/auth/strategy.yaml` instead. Every strategy reduces to the same artifact — a cached `storageState` (cookies + localStorage), plus, for connection-level schemes, context options (`httpCredentials` / `extraHTTPHeaders` / `clientCertificates`) — so the rest of the suite stays auth-agnostic. `creds_env` maps credential **keys to env-var names**; secret values never appear in the descriptor, artifacts, or error messages. Any credential env value may be a comma-separated **user pool** (`u1,u2,u3`): parallel worker N consistently picks entry `N % len` across every pooled variable.

| Strategy         | Scheme                                                                                              | Key `options`                                                                                                                            | `creds_env` keys                                |
| ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `api-login`      | POST creds to the app's login endpoint over plain HTTP; cookies collected across the redirect chain | `login_url`, `method`, `body_format: json\|form`, `success_check: {cookie}\|{status}\|{json_path, equals}`                               | `username`, `password`                          |
| `ui-form`        | drive the app's own login form in headless Chromium                                                 | `login_url`, `username_selector`, `password_selector`, `submit_selector`, `success_selector` or `url_matches`, `pre_steps`, `totp`       | `username`, `password`                          |
| `totp`           | not standalone — an RFC-6238 hop **inside** `ui-form` via `options.totp`                            | `totp: { secret_env, otp_selector, submit_selector?, digits?, period?, algorithm? }`                                                     | (via `ui-form`)                                 |
| `email-otp`      | `ui-form` whose second factor arrives by mail; an `InboxProvider` polls the inbox for the code      | `otp_selector`, `otp_submit_selector?`, `inbox: { provider (default http-json), options: { url }, to_env?, code_pattern?, timeout_ms? }` | `username`, `password`                          |
| `webauthn`       | passkey login through a CDP virtual authenticator (ctap2/internal, attached before navigation)      | `login_url`, `trigger_selector`, `username_selector?`, `success_selector` or `url_matches`, `pre_steps`                                  | `username` (username-first only)                |
| `jwt-injection`  | mint (OAuth2 client-credentials) or read a static token; inject into localStorage / a cookie        | `token_env` or `token_url`, `inject: { localStorage: [{key, value_template}], cookies: [{name, …}] }`                                    | `client_id`, `client_secret` (with `token_url`) |
| `http-basic`     | connection-level HTTP Basic via Playwright `httpCredentials`                                        | —                                                                                                                                        | `username`, `password`                          |
| `pat-header`     | static personal-access-token header via `extraHTTPHeaders`                                          | `header` (default `Authorization`), `value_template` (default `Bearer {{token}}`)                                                        | `token`                                         |
| `mtls`           | client-certificate auth via Playwright `clientCertificates`                                         | `origin?` (default: the base URL's origin)                                                                                               | `cert`, `key` (PEM file _paths_), `passphrase?` |
| `test-backdoor`  | POST a shared secret to a test-only login endpoint (dev/staging builds)                             | `url`, `user_id?`, `success_cookie?`                                                                                                     | `secret`                                        |
| `manual-capture` | human logs in via instrumented Chrome (see above)                                                   | `capture_trigger: console\|button`                                                                                                       | —                                               |

Every strategy reports `expiresAt` when it is derivable (the named / lone real-expiry cookie via the jar, the JWT `exp` claim, the token endpoint's `expires_in`); otherwise the cache's `auth_cookie` / `ttl` rules above take over. Plugins can add schemes or replace a built-in via `registerAuthStrategy(name, impl)` (consulted before the built-ins); `email-otp` inboxes beyond the Mailpit-style `http-json` poller register via `registerInboxProvider(name, factory)`.

## Step 4 — get the flow-files (calibrate)

- **If the human has a structured flow-guide** (a `.flow.yaml`, or a `.md` with a ```yaml fenced block — the the first-consumer testing guide shape: prerequisites + locators + per-step actions + success criteria):

  ```bash
  docsxai calibrate "$WORKSPACE" --from path/to/flow-guide.md     # writes $WORKSPACE/flows/<name>.flow.yaml + a default docs/style.yaml
  ```

- **If the description is loose prose, or a manual-testing-guide** (whose fenced blocks are numbered prose pseudo-steps — `1. SETUP …`, `VERIFY …` — not flow-file YAML, so `--from` _won't_ take them), or you need to pin elements against the live page: author the flow-file yourself. Walk each step on the live app, pick **one canonical locator per step** (prefer role/text/`data-testid`), add `wait_for`/`success`, and write `$WORKSPACE/flows/<flow>.flow.yaml` by hand. To inspect the _authed_ live page for locators — note you **can't** load the captured session into a browser your MCP/automation controls (the app's auth cookie is usually `httpOnly`, so not settable via `document.cookie`) — use **`docsxai inspect "$WORKSPACE"`**: it opens the app headless with `.auth/<role>.json` loaded and prints the page's `[data-testid]` elements (✓ = visible); `--selector '<css>'` dumps matching elements' HTML; `--headed` watches; `--url <url>` for a sub-page. Iterate: `inspect` → write a step → `docsxai run` → repeat. The full playbook is `$TOOL_REPO/packages/plugin/skills/calibrate/SKILL.md`. (A one-command agent-driven `/docsxai:calibrate` via an MCP server isn't built yet.)

The flow-file format (validate by running `calibrate` or `run`):

```yaml
name: <flow-name>
extends: <another-flow-name> # optional — run that flow's steps FIRST (locators/prereqs merged, this flow wins on locator-name collisions; step ids must be unique across the merge; chains ok, cycles rejected). Use it to share a preamble (Library → open a video → editor) so dependent flows don't re-walk it.
environment: # optional — deterministic execution environment, applied at browser-context creation (whole flow runs under it). With `extends`, merged per-key — this flow's keys win over the parent's.
  clock: "2030-01-02T03:04:05Z" # freeze the page clock at this ISO-8601 instant — new Date() etc. return it for the whole run (deterministic dates in screenshots)
  locale: en-GB # BCP-47
  timezone: Europe/Amsterdam # IANA tz
  viewport: desktop # desktop (1440×900) | tablet (834×1112) | mobile (390×844) | { width: W, height: H }
  color_scheme: dark # light | dark
  reduced_motion: true
redactions: # optional — masked on EVERY screenshot this flow produces, halt shots included. With `extends`, parent's + this flow's concatenate.
  - { selector: $api_key_field } # element's bounding box at capture time; an absent element is skipped with a stderr warning (vacuously redacted — never a halt)
  - { region: { x: 10, y: 80, width: 220, height: 40 }, style: pixelate } # fixed CSS-px rect. style: box (default — solid #000) | pixelate (16-px mosaic)
prerequisites: [{ logged_in_as: editor }] # optional
locators: { play_button: "#play", recap_panel: "#recap" } # one canonical selector per name; no fallbacks
steps:
  - id: open-app
    action: navigate
    value: /dashboard # `navigate` takes `value` (a path resolved against the workspace app_url, or an absolute URL) — NOT `target`
    wait_for: load # network_idle | load | element_stable | { selector: $x } | { timeout_ms: N }
  - id: open-sidebar
    action: click # navigate|click|fill|upload|press|hover|select|check|uncheck|wait. click/hover/check/uncheck take `target`; fill/select/press/upload take `target` + `value`; navigate takes `value`
    target: $play_button # $name (from `locators`) or an inline selector
    wait_for: { selector: $recap_panel }
    success: { visible: $recap_panel } # visible | hidden | { url_matches: '...' } | { text_contains: { selector: $x, text: '...' } } — halts on failure
    annotation: { copy: "Click Play to open the recap sidebar", arrow: top-right } # one call-out; OR — for several on the same screenshot — use `annotations:` (plural), which renders them as numbered badges so the reader sees up front there's more than one thing to look at:
    # annotations:
    #   - { copy: "the play button", target: $play_button, arrow: top, nudge: { x: -30, y: 0 } }   # nudge: optional pixel offset on the callout+arrow only (halo stays). Use when two callouts overlap.
    #   - { copy: "the panel that opened", target: $recap_panel, arrow: left }
  - id: dismiss-confirm-modal
    action: click
    target: $modal_ok
    optional: true # best-effort: if the action/wait/success throws (target absent, wait timed out), SKIP and continue instead of halting.
    wait_for:
      { selector: $modal_ok } # For conditionally-present UI (a confirm modal that sometimes appears, a first-run tooltip, a cookie banner).
      # Skipped optional step → no screenshot/annotation. PREFER this over a permissive comma-selector that no-ops on one branch.
    redactions: # optional, per-step — additive on top of the flow-level list, for this step's screenshots only
      - { selector: $billing_total, style: box }
```

**Determinism (environment + redactions + element_stable).** The `environment` block is what makes runs reproducible across machines and days: a frozen `clock`, pinned `locale`/`timezone`/`viewport`/`color_scheme`/`reduced_motion` → the same flow against the same target state produces **byte-identical screenshots** (keystone-enforced). It also unlocks locale replay (`extends` a base flow, override just `locale`) and responsive variants (override just `viewport`). With `--cdp` the attached Chrome owns its context, so only the clock applies — the engine logs one stderr warning listing the skipped fields. `redactions` mask sensitive UI (API keys, customer PII) **before the PNG hits disk** — deterministic pixel fills, so they don't break reproducibility; halt screenshots get them too. An annotation anchored to a redacted element would point at a black box — `lint` flags that. `wait_for: element_stable` on a step with a `target` polls that element's bounding box every 100 ms until two consecutive reads agree (±0.5 px), with a 10 s budget — best-effort: a perpetually-animating element proceeds after the budget rather than wedging the run. Without a `target` it waits on nothing (`lint` flags that too).

**Iterating, esp. on long / stateful flows.** For a slow backend op (generate, translate, render…), give the waiting step `wait_for: { selector: $appears-when-done, timeout_ms: 180000 }` — a per-step override of the default ~30s selector-wait. **Sub-3-sec inner loop on long-async flows:** when iterating on a new tail step that sits after a multi-minute backend op, use `docsxai run "$WORKSPACE" --flow <name> --cdp http://localhost:9222 --start-from <step-id>` to attach to the already-warm Chrome (left over from a `--pause`d previous run, or your `capture-auth --cdp` Chrome) and SKIP every step before `<step-id>` — only the new step runs, against the existing page state. The new step's annotation is merged into the existing `annotations.json`; prior steps' annotations and screenshots stay intact. With `--cdp` the cached `storageState` isn't loaded — the operator's Chrome owns its auth state. **Factor out shared preambles**: put the multi-step "get to the right place" walk in its own flow-file — e.g. `flows/preamble.flow.yaml`, _no `annotation`s_ — and have each dependent flow start with `extends: preamble`; the engine runs the parent's steps first, so iterating on the _child_'s steps is cheap and the un-annotated parent adds zero doc noise. To iterate without even re-running the parent each time: **`docsxai run "$WORKSPACE" --flow <name> --stop-after <step-id> --pause`** runs only up to that step (on the merged step list — so `--stop-after` can target a parent step too) and leaves the (headed) browser open there — inspect the live state, fix/add the next step, repeat. **To shrink total wall time when you have many flows**: `--concurrency <N>` runs up to N flows in parallel (each its own Chromium session); the target app needs to tolerate concurrent sessions from one user, but most do. Force-clamped to 1 with `--pause` / `--stop-after`. **Catch authoring mistakes at write-time:** `docsxai lint "$WORKSPACE"` runs pure-static checks across your flow-files (deep `extends` chains, annotations anchored to likely-unmounting click targets, `wait_for` without `timeout_ms` on long-async-looking steps, bare `[data-*=…]` selectors prone to hidden duplicates, `extends` targets that don't exist, locators defined but never referenced, terminal steps without `success`, `optional` steps with no `wait_for`/`success` guard, selector-less `element_stable`, annotations anchored to redacted elements). **Visualise inheritance:** `docsxai flow-tree "$WORKSPACE"` prints the workspace's `extends` graph + checks step-id uniqueness across each chain. **When a step halts**, the error message starts with a `[cause: …]` prefix inferred from Playwright's actionability log (e.g. `[target is disabled]`, `[target was detached from the DOM]`, `[selector matched multiple elements …]`) — read that first; the screenshot in `docs/<flow>/halts/<step>.png` is for confirming. **Diagnose the halt + propose a fix:** `docsxai diagnose "$WORKSPACE" --flow <name> --step <step-id> [--cdp http://localhost:9222] [--format json]` packages the step's selector / wait*for / success / halt-screenshot path / (with `--cdp`) a live `actionable()` probe of the target on the running page, plus typed recommendations (`selector` / `wait_for` / `success` / `annotation_target` / `split_step` / `investigate`). Pair with `--start-from <step-id> --cdp <endpoint>` on the follow-up `run` to validate the fix in seconds. The engine never auto-patches the flow-file — diagnosis is gathered context for an agent decision. See [`packages/plugin/skills/diagnose/SKILL.md`](../packages/plugin/skills/diagnose/SKILL.md) for the full loop. **Discovery-time actionability probing:** the engine exposes a `BrowserDriver.actionable(selector)` predicate that returns the same vocabulary at write-time, without acting — `actionable` / `not-found` / `multiple-matches` / `detached` / `not-visible` / `off-screen` / `covered` / `disabled`. Designed for consumers like browxai (and future MCP browser bridges) to surface on `find()` results so a calibration agent can know \_before* the step is written into a flow-file whether the selector is fillable / clickable / scopable. Full contract + per-state semantics + the coordination-with-halt-cause mapping: [`docs/actionability-contract.md`](actionability-contract.md).

**Discovery driver (locator finding against the authed live page).** The canonical, model-agnostic driver is **[browxai](https://github.com/kalebteccom/browxai)** — an MCP-native browser bridge. The host agent gets `find(query)` (ranked candidate locators with `selectorHint` + `stability: high|medium|low` + visible-rect bbox + evidence), `snapshot()` (compact a11y tree **augmented with a DOM walk on every snapshot** — interactive elements via `[role], button, a[href], input, select, textarea, [onclick], [tabindex], [contenteditable]` plus any test-attr bearer, merged under the same root with `[from-dom]` / `[from-both]` source markers so heavy-SPA targets aren't sparse), persistent refs within a session, action primitives that return what changed, `await_human({kind:"acknowledge", prompt})` checkpoints, plus screenshots / console / network reads.

**Setup — one command.** Browxai now ships its own bootstrap. From the consumer-workspace dir, run:

```bash
browxai init "$WORKSPACE/.browxai"   # creates the workspace dir, writes a workspace-scope .mcp.json
                                      # with both managed + attached MCP entries, sniffs the codebase
                                      # for the dominant test-attribute convention
browxai doctor                        # health-check: build, workspace, test-attrs, cdp reachability,
                                      # chromium binary, capabilities, confirm-hooks, origins
```

Pick `browxai` for ad-hoc / public-target work; pick `browxai-attached` when a `--cdp` Chrome is already up. (Manual `claude mcp add-json` / TOML-`mcp_servers` block recipes are still valid alternatives — see [`<browxai>/AGENT-RUNBOOK.md`](https://github.com/kalebteccom/browxai) for both.)

**Configure `BROWX_TEST_ATTRIBUTES` for your target's codebase.** `browxai init` sniffs it for you; override manually if needed. Comma-separated, **order-sensitive, first match wins**. Default if unset: `data-testid,data-test,data-cy,data-qa`. If the target codebase anchors interactivity on a non-standard attribute, put it in the list (e.g. a codebase using `data-type` rather than `data-testid` would set `data-testid,data-type,data-test,data-cy,data-qa`). Flows through a11y enrichment, the DOM walk, `selectorHint` tier-1 emission, and locator resolution. Tier-1 doesn't gate on a `role` wrapper — `<div data-type="x">` gets `stability: "high"` directly with hint `[data-type="x"]`.

**Calibration accelerator — record the walk, get a draft flow-file.** Instead of hand-authoring `flows/<name>.flow.yaml` step-by-step, drive the live walk through browxai's action tools while `start_recording({ flowName: "<name>" })` is active; `end_recording()` emits a docsxai-flavoured YAML draft (`locators:` + `steps:` with `selectorHint`-derived targets) you can review, edit, and commit. Annotations are captured per step via `record_annotate({ copy, arrow?, … })`. Pair with `docsxai run --start-from --cdp` to validate each step in seconds after edits.

**Canonical browxai-operational reference.** Snapshot output legend (`stats:` block, `warnings:`, `[from-dom]` / `[from-both]` markers), locator-disambiguation idioms (`:visible`, `nth-match` for hidden-duplicate testids), `stability` semantics (snapshot-disambiguator vs deploy-stable — content-keyed IDs come back `stability: "high"` and need rewriting before they go into a flow-file), `find()`-query-matching surface (name + role + test-attribute _values_; icon-only `title="…"` tabs need keyword reframing), and any other operational gotchas live in **`<browxai>/AGENT-RUNBOOK.md`** — docsxai doesn't duplicate that content. Read it before driving a fresh calibration; it's the single source of truth for "how to actually use the tools."

**Fallbacks if browxai itself misbehaves on a specific page:** **(a)** `docsxai inspect "$WORKSPACE" --cdp http://localhost:9222 --wait-for '<a-testid-that-mounts-when-ready>'` attaches to the same `--cdp` Chrome and settles before the snapshot (or `--wait <ms>`); without `--cdp`/`--wait` it launches a fresh headless browser with the cached session and snapshots _immediately_, which on a slow SPA catches the page pre-hydration; **(b)** drive the `--cdp` Chrome with Playwright directly (`chromium.connectOverCDP('http://localhost:9222')` → full Playwright API, persistent). _Alternative driver:_ Anthropic's **Claude in Chrome** extension still works in a Claude-Code-driven session but is Claude-locked, so it isn't the canonical path; reach for it only when browxai isn't an option. Note: when the `--cdp` Chrome is launched with `--load-extension=…/Claude`, the extension _files_ load but the Claude-in-Chrome MCP tools stay paired to your host session's Chrome — they don't auto-attach to the new instance; browxai (and Playwright-over-CDP) cover the discovery need there. Prefer `success` assertions on **content that only appears in the target state** (e.g. `text_contains: { selector: 'body', text: 'Mandarin' }`) over structural selectors that may match stale/hidden poppers.

**Conditionally-present UI (the optional-step pattern).** When a step targets an element that _may or may not be there_ — a confirmation modal that appears only sometimes, a first-run tooltip, a cookie banner, an A/B variant — mark the step `optional: true`. If its action / `wait_for` / `success` throws, the engine logs `runFlow: optional step "<id>" skipped — <reason>` to stderr and continues to the next step instead of halting. A skipped optional step emits no screenshot/annotation. **Do not** fake this with a permissive comma-selector that deliberately no-ops on one branch (e.g. `'button:has-text("OK"):visible, [data-type="title"]:visible'` — clicking the title is a semantic no-op that can mis-fire if the title has a handler); `optional: true` is the first-class primitive for exactly this and is what `lint` won't flag.

**Locator gotchas worth pre-empting.** When a `data-*` attribute might bind to a _hidden duplicate_ in the DOM (Playwright's strict-mode match can pick the phantom — a click then retries 30s for a bbox), scope with `:visible` (`[data-foo="bar"]:visible`) or use a role/text selector. When a step's action **transitions the UI** — i.e. the action target gets unmounted as a new state mounts — the annotation's halo would have nothing to anchor to: give the annotation a `target` override pointing at an element that _does_ exist in the resulting state — `annotation: { copy: "<what you want to say>", arrow: top, target: $appearing_element }`. (Default `annotation.target` = the step's `target`; setting it decouples the _halo anchor_ from the _action target_.) If a step _halts_, a screenshot of the moment is written to **`docs/<flow>/halts/<step>.png`** (its path is in the error message) — open that first; it'll usually tell you in seconds what a 30-second timeout couldn't.

## Step 5 — run, view

```bash
docsxai run "$WORKSPACE"                  # headless Chromium; uses .auth/<role>.json; replays flows; refreshes docs/<flow>/annotations.json + screenshots
docsxai render "$WORKSPACE"               # builds $WORKSPACE/.viewer/index.html
# open "$WORKSPACE/.viewer/index.html"
```

If `run` halts on a step (a locator or success-criterion failure) that's _drift_, not a flake — don't retry blindly; report the failing step id + what changed, and propose a minimal flow-file edit (the `diagnose` playbook is `$TOOL_REPO/packages/plugin/skills/diagnose/SKILL.md`). Genuine flakiness → add async primitives (`wait_for: network_idle` / `element_stable` / a timeout) to the flow-file, documented inline.

## Drift detection + baselines

After a good `run`, snapshot the doc pack and let CI catch the target app drifting out from under it:

```bash
docsxai baseline "$WORKSPACE"             # snapshots flows/ + docs/ (md, annotations, screenshots) + locators into $WORKSPACE/.baseline/ — commit it
docsxai diff "$WORKSPACE" --format md     # PR-comment-ready drift report against .baseline/ (use --against <dir> for another snapshot)
docsxai diff "$WORKSPACE" --fail-on warn  # CI gate: exit 1 at/above the threshold (warn|fail)
```

The report is deterministic (no timestamps) and per flow: step field deltas (id-keyed), annotation moves beyond a pixel tolerance, screenshot pixel diffs (changed-pixel count / % / changed-region bbox; ≥1% = warn, ≥5% = fail by default; dimension changes flagged distinctly), prose line-change counts, and locator changes. The engine only **detects** — when drift is real, follow the `diagnose` playbook and propose the flow-file patch yourself; programmatic policy (custom thresholds, `ignore_regions` for clocks/ads) is `diffDocPacks` on the library surface.

## Exporting flows as tests

```bash
docsxai export playwright "$WORKSPACE"    # one self-contained .spec.ts per flow → $WORKSPACE/.export/tests/
```

Each spec carries the resolved `extends` chain: locators as consts, steps as Playwright actions, `success` criteria as `expect()` assertions, the `environment` block as `test.use()` (+ `page.clock.setFixedTime` for a frozen clock), and `optional` steps wrapped in try/catch. Drop the specs into the app team's Playwright suite as a regression tripwire — and regenerate instead of hand-editing (the header says so; the flow-file stays the source of truth).

## Publishing the docs (optional)

Two delivery shapes, both downstream of `run`:

- **Agentic path** (recommended for engagements): `docsxai export adf "$WORKSPACE"` writes `$WORKSPACE/.export/adf/{projection,attachments}.json` — hand these to the Atlassian MCP (or any wiki tool the host agent drives) and let the human review the upload. The engine never holds wiki credentials on this path.
- **Direct push** (CI/backend automation): configure the workspace's publisher plugin (`.docsxai.json` → `plugins` + `plugin_capabilities`, e.g. `@docsxai/plugin-confluence` with `egress:*.atlassian.net`) and invoke `confluence:push` with the projection. Idempotent by content-sha — re-publishing an unchanged pack mutates nothing. Burned screenshots (`docsxai-viewer burn "$WORKSPACE"`) are what land on static surfaces; run `burn` before exporting.

## Step 6 — tear down, verify clean

```bash
# stop the dev server
git -C "$APP_REPO" worktree remove --force "$APP_RUN"
git -C "$APP_REPO" status        # MUST be clean. If not, you broke the no-trace contract — fix it.
# the workspace ($WORKSPACE) is yours to keep or `rm -rf`.
```

## Caveats to surface to the human

- The agent-driven calibration _pipeline stages_ (the MCP-server loop where you'd call engine stage functions and resolve ambiguities against the live page) aren't built — step 4 for loose prose is a manual flow-file authoring task following the playbook. The deterministic `init`/`calibrate`(structured)/`run`/`render`/`capture-auth` are real.
- `claude plugin install` from a monorepo subdir (`$TOOL_REPO/packages/plugin`) isn't validated yet — if it doesn't register, use the CLIs + the playbook files directly.
- `manual-capture` sessions are short (≈ the app's auth-cookie lifetime). Pin `cache.auth_cookie` (Step 3) so the cache's expiry tracks the real cookie rather than the `ttl` guess. A callable login / test-only login endpoint on the app would make `run` unattended; absent that, expect to re-`capture-auth` (re-login) periodically.
- HTTPS dev certs: `--ignore-https-errors` (already baked into `.docsxai.json` if you passed it to `init`) accepts them. The app may also need gitignored files (`.env`, a dev-cert dir) copied into the worktree to boot (Step 2).
- The dev server may bind a different port than expected if the default's taken — use the URL it actually prints (Step 2).
