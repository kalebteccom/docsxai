# Agent runbook — run site-docs against an app repo, leaving no trace

> Hand this file to a coding agent. It tells the agent how to set up and run **site-docs** to document a
> running web app that's built/served from a local repo — **without modifying that repo**. site-docs operates
> *on* the running app from outside; everything it produces lives in a separate workspace dir; the app itself
> is run from a throwaway git worktree so even its build scripts can't dirty the real checkout.

## Inputs the human gives you

Fill these in before starting:

```bash
export APP_REPO=…          # the source checkout of ANY web app you want to document. YOU MUST NOT MODIFY THIS.
export TOOL_REPO=…         # the site-docs repo (this repo: automated-site-documentation-bot)
export WORKSPACE=…         # where site-docs artifacts go — MUST be OUTSIDE $APP_REPO. e.g. ~/site-docs/<app-name>
export APP_RUN=/tmp/site-docs-app-run   # disposable copy of $APP_REPO that you'll actually run
# After step 2 you'll also know $APP_URL (the dev server's URL).
```

If the human only gave you `$APP_REPO`, pick sensible defaults for the others and tell them what you chose.

## Hard rules (the "no trace" contract)

1. **Never write any file inside `$APP_REPO`.** Not the doc pack, not config, not `.claude/`, nothing. All site-docs output → `$WORKSPACE` (which is outside `$APP_REPO`).
2. **Never `npm install` / `pnpm install` / build inside `$APP_REPO`.** Run the app from `$APP_RUN` (a disposable worktree); its `node_modules`/lockfile changes stay there.
3. **Never vendor the site-docs skill into `$APP_REPO/.claude/`.** Use the CLIs from `$TOOL_REPO` (and the Claude Code plugin if installed) — don't `vendorSkill` into the app repo.
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

Make `site-docs` / `site-docs-viewer` callable. The robust way is two tiny wrapper scripts on your `PATH`:

```bash
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexec node "%s/packages/engine/dist/cli.js" "$@"\n' "$TOOL_REPO" > "$HOME/.local/bin/site-docs"
printf '#!/usr/bin/env bash\nexec node "%s/packages/viewer/dist/index.js" "$@"\n' "$TOOL_REPO" > "$HOME/.local/bin/site-docs-viewer"
chmod +x "$HOME/.local/bin/site-docs" "$HOME/.local/bin/site-docs-viewer"
export PATH="$HOME/.local/bin:$PATH"
```

(`pnpm -C packages/{engine,viewer} link --global` also works *if* your pnpm global store is consistent — it often isn't on a long-lived machine; `ERR_PNPM_UNEXPECTED_STORE` is fixed by `pnpm install --global pnpm`. The wrapper scripts above sidestep all of that.) Below assumes `site-docs` / `site-docs-viewer` are on `PATH`; equivalently call `node "$TOOL_REPO/packages/engine/dist/cli.js" …` etc. directly.

## Step 1 — scaffold the workspace (one command, with the config baked in)

```bash
site-docs init "$WORKSPACE" --app-url "$APP_URL_PLACEHOLDER" --ignore-https-errors --auth manual-capture --ttl 1h
```

(If you don't know `$APP_URL` yet, run `site-docs init "$WORKSPACE" --auth manual-capture --ttl 1h` now and add `app_url` to `$WORKSPACE/.site-docs.json` after step 2 — or just pass `--base-url` on later commands.)

This creates `$WORKSPACE/{flows,docs,auth,.auth,.viewer}`, a `.gitignore` (`.auth/`, `.viewer/`), `auth/strategy.yaml` (`manual-capture`, `store: local`, `ttl: 1h`), a `README.md`, and `.site-docs.json` (holds `app_url` + `ignore_https_errors`, so subsequent `run`/`capture-auth` need no flags). For a fully ephemeral workspace instead: `site-docs init --persist tmp …` (it prints the temp dir; `rm -rf` it when done).

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
node -e "const f='$WORKSPACE/.site-docs.json',j=require(f);j.app_url='$APP_URL';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
```

(Alternatively `git clone --no-hardlinks "$APP_REPO" "$APP_RUN"`.)

## Step 3 — capture an authed session (if the app needs login)

```bash
site-docs capture-auth "$WORKSPACE"        # reads app_url + ignore_https_errors from .site-docs.json
```

An instrumented Chrome opens (headed). The **human** logs in interactively (SSO / MFA / conditional access — whatever they click through). When they're in, they run `window.__siteDocs.capture()` in the devtools console (or click the injected "Capture session" button if `--capture-trigger button` was set). The session is cached to `$WORKSPACE/.auth/<role>.json`. **Tell the human these steps** — you can't log in for them. `capture-auth` keeps a persistent Chrome profile at `$WORKSPACE/.auth/chrome-profile/` (gitignored), so once they've logged in once, **re-running `capture-auth` reuses that session — usually they just trigger capture again, no re-login**. `--fresh` forces a clean profile.

`capture-auth` prints the captured cookie jar. **Identify the app's real auth/session cookie** and pin it so the cache tracks its actual expiry — otherwise the cache falls back to the `ttl` guess (which is what stops a freshly-captured SSO session from being "born expired": the jar has ephemeral IdP scratch cookies whose expiry is seconds out, so `min(cookie.expires)` ≈ now and must NOT be trusted — but `ttl` is still a guess; the real auth cookie's expiry is the true bound). The auth cookie is:
- on the **app's own domain** (e.g. `app.example.com` / `localhost:<port>` — *not* the identity provider's domain: `login.microsoftonline.com`, `accounts.google.com`, `*.okta.com`, …),
- the **long-lived** one (latest expiry among app-domain cookies),
- typically named like `session` / `connect.sid` / `auth_token` / `JSESSIONID` / `_session_id`, or `.AspNetCore.Cookies` (any ASP.NET Core app — sometimes chunked into `…C1`/`…C2`) / `<AppName>Identity*` (an app's own identity cookie).

Then pin it (any of):

```bash
site-docs capture-auth "$WORKSPACE" --auth-cookie "<the-cookie-you-identified>"   # e.g. "session" / ".AspNetCore.Cookies"
#   or: edit $WORKSPACE/auth/strategy.yaml → roles.<role>.cache.auth_cookie: "<name>"  (then re-run capture-auth)
#   or: pass it up front:  site-docs init … --auth-cookie "<name>"
```

`capture-auth` reports `expires <ISO>  (from auth-cookie "<name>" | ttl | 1h default)` — confirm it says `auth-cookie "<name>"`. If `run` later says "session expired", re-run this step (re-login).

**Optional — one login, not two:** by default `capture-auth` launches its own instrumented Chrome, so the engineer logs in there *and* (separately) in whatever browser the host agent uses for discovery (Step 4). To avoid the double login, have the engineer start a single Chrome that *both* tools attach to: `chrome --remote-debugging-port=9222 --disable-web-security --disable-features=IsolateOrigins,site-per-process --user-data-dir=/tmp/site-docs-chrome <app-url>` — the engineer logs in once, then `site-docs capture-auth "$WORKSPACE" --cdp http://localhost:9222` reads that browser's session (it won't close it), and Step 4's discovery driver attaches over CDP to the same endpoint. *(Caveat: whether your specific discovery driver — browxai, the legacy Claude-in-Chrome extension, or raw Playwright-over-CDP — attaches cleanly to a Chrome launched this way needs verifying in practice; if it doesn't, fall back to the default two-session flow above; it works.)*

## Step 4 — get the flow-files (calibrate)

- **If the human has a structured flow-guide** (a `.flow.yaml`, or a `.md` with a ```yaml fenced block — the the first-consumer testing guide shape: prerequisites + locators + per-step actions + success criteria):

  ```bash
  site-docs calibrate "$WORKSPACE" --from path/to/flow-guide.md     # writes $WORKSPACE/flows/<name>.flow.yaml + a default docs/style.yaml
  ```

- **If the description is loose prose, or a manual-testing-guide** (whose fenced blocks are numbered prose pseudo-steps — `1. SETUP …`, `VERIFY …` — not flow-file YAML, so `--from` *won't* take them), or you need to pin elements against the live page: author the flow-file yourself. Walk each step on the live app, pick **one canonical locator per step** (prefer role/text/`data-testid`), add `wait_for`/`success`, and write `$WORKSPACE/flows/<flow>.flow.yaml` by hand. To inspect the *authed* live page for locators — note you **can't** load the captured session into a browser your MCP/automation controls (the app's auth cookie is usually `httpOnly`, so not settable via `document.cookie`) — use **`site-docs inspect "$WORKSPACE"`**: it opens the app headless with `.auth/<role>.json` loaded and prints the page's `[data-testid]` elements (✓ = visible); `--selector '<css>'` dumps matching elements' HTML; `--headed` watches; `--url <url>` for a sub-page. Iterate: `inspect` → write a step → `site-docs run` → repeat. The full playbook is `$TOOL_REPO/packages/plugin/skills/calibrate/SKILL.md`. (A one-command agent-driven `/site-docs:calibrate` via an MCP server isn't built yet.)

The flow-file format (validate by running `calibrate` or `run`):

```yaml
name: <flow-name>
extends: <another-flow-name>                      # optional — run that flow's steps FIRST (locators/prereqs merged, this flow wins on locator-name collisions; step ids must be unique across the merge; chains ok, cycles rejected). Use it to share a preamble (Library → open a video → editor) so dependent flows don't re-walk it.
prerequisites: [ { logged_in_as: editor } ]      # optional
locators: { play_button: '#play', recap_panel: '#recap' }   # one canonical selector per name; no fallbacks
steps:
  - id: open-app
    action: navigate
    value: /dashboard                            # `navigate` takes `value` (a path resolved against the workspace app_url, or an absolute URL) — NOT `target`
    wait_for: load                               # network_idle | load | element_stable | { selector: $x } | { timeout_ms: N }
  - id: open-sidebar
    action: click                                # navigate|click|fill|press|hover|select|check|uncheck|wait. click/hover/check/uncheck take `target`; fill/select/press take `target` + `value`; navigate takes `value`
    target: $play_button                         # $name (from `locators`) or an inline selector
    wait_for: { selector: $recap_panel }
    success: { visible: $recap_panel }           # visible | hidden | { url_matches: '...' } | { text_contains: { selector: $x, text: '...' } } — halts on failure
    annotation: { copy: "Click Play to open the recap sidebar", arrow: top-right }   # one call-out; OR — for several on the same screenshot — use `annotations:` (plural), which renders them as numbered badges so the reader sees up front there's more than one thing to look at:
    # annotations:
    #   - { copy: "the play button", target: $play_button, arrow: top, nudge: { x: -30, y: 0 } }   # nudge: optional pixel offset on the callout+arrow only (halo stays). Use when two callouts overlap.
    #   - { copy: "the panel that opened", target: $recap_panel, arrow: left }
```

**Iterating, esp. on long / stateful flows.** For a slow backend op (generate, translate, render…), give the waiting step `wait_for: { selector: $appears-when-done, timeout_ms: 180000 }` — a per-step override of the default ~30s selector-wait. **Sub-3-sec inner loop on long-async flows:** when iterating on a new tail step that sits after a multi-minute backend op, use `site-docs run "$WORKSPACE" --flow <name> --cdp http://localhost:9222 --start-from <step-id>` to attach to the already-warm Chrome (left over from a `--pause`d previous run, or your `capture-auth --cdp` Chrome) and SKIP every step before `<step-id>` — only the new step runs, against the existing page state. The new step's annotation is merged into the existing `annotations.json`; prior steps' annotations and screenshots stay intact. With `--cdp` the cached `storageState` isn't loaded — the operator's Chrome owns its auth state. **Factor out shared preambles**: put the multi-step "get to the right place" walk in its own flow-file — e.g. `flows/preamble.flow.yaml`, *no `annotation`s* — and have each dependent flow start with `extends: preamble`; the engine runs the parent's steps first, so iterating on the *child*'s steps is cheap and the un-annotated parent adds zero doc noise. To iterate without even re-running the parent each time: **`site-docs run "$WORKSPACE" --flow <name> --stop-after <step-id> --pause`** runs only up to that step (on the merged step list — so `--stop-after` can target a parent step too) and leaves the (headed) browser open there — inspect the live state, fix/add the next step, repeat. **To shrink total wall time when you have many flows**: `--concurrency <N>` runs up to N flows in parallel (each its own Chromium session); the target app needs to tolerate concurrent sessions from one user, but most do. Force-clamped to 1 with `--pause` / `--stop-after`. **Catch authoring mistakes at write-time:** `site-docs lint "$WORKSPACE"` runs pure-static checks across your flow-files (deep `extends` chains, annotations anchored to likely-unmounting click targets, `wait_for` without `timeout_ms` on long-async-looking steps, bare `[data-*=…]` selectors prone to hidden duplicates). **Visualise inheritance:** `site-docs flow-tree "$WORKSPACE"` prints the workspace's `extends` graph + checks step-id uniqueness across each chain. **When a step halts**, the error message starts with a `[cause: …]` prefix inferred from Playwright's actionability log (e.g. `[target is disabled]`, `[target was detached from the DOM]`, `[selector matched multiple elements …]`) — read that first; the screenshot in `docs/<flow>/halts/<step>.png` is for confirming. **Discovery-time actionability probing:** the engine exposes a `BrowserDriver.actionable(selector)` predicate that returns the same vocabulary at write-time, without acting — `actionable` / `not-found` / `multiple-matches` / `detached` / `not-visible` / `off-screen` / `covered` / `disabled`. Designed for consumers like browxai (and future MCP browser bridges) to surface on `find()` results so a calibration agent can know *before* the step is written into a flow-file whether the selector is fillable / clickable / scopable. Full contract + per-state semantics + the coordination-with-halt-cause mapping: [`docs/actionability-contract.md`](actionability-contract.md).

**Discovery driver (locator finding against the authed live page).** The canonical, model-agnostic driver is **[browxai](https://github.com/kalebteccom/browxai)** — Kalebtec's MCP-native browser bridge; portfolio entry `projects/agent-browser-bridge/`. Phase 1 + a same-day Phase-1.5 pass against the first adoption (the target app 2026-05-13) have shipped: the host agent gets `find(query)` (ranked candidate locators with `selectorHint` + `stability: high|medium|low` + visible-rect bbox + evidence), `snapshot()` (compact a11y tree **augmented with a DOM walk on every snapshot** — interactive elements via `[role], button, a[href], input, select, textarea, [onclick], [tabindex], [contenteditable]` plus any test-attr bearer, merged under the same root with `[from-dom]` / `[from-both]` source markers so heavy-SPA targets like Reflux / legacy-React aren't sparse), persistent refs within a session, action primitives that return what changed, `await_human({kind:"acknowledge", prompt})` checkpoints, plus screenshots / console / network reads.

**Setup — dual MCP registration.** Browxai supports two session modes; until auto-default attach lands (Phase-1.5 polish), register both so you pick at use time:

```bash
# managed (default — browxai launches its own Chromium under BROWX_WORKSPACE/profile/)
JSON='{"command":"node","args":["<absolute path>/browxai/dist/cli.js"],"env":{"BROWX_WORKSPACE":"'"$WORKSPACE"'/.browxai","BROWX_TEST_ATTRIBUTES":"data-testid,data-test,data-cy,data-qa"}}'
claude mcp add-json -s user browxai "$JSON"

# attached (BYOB — attaches to the capture-auth --cdp Chrome on loopback:9222)
JSON='{"command":"node","args":["<absolute path>/browxai/dist/cli.js"],"env":{"BROWX_WORKSPACE":"'"$WORKSPACE"'/.browxai","BROWX_TEST_ATTRIBUTES":"data-testid,data-test,data-cy,data-qa","BROWX_ATTACH_CDP":"http://127.0.0.1:9222"}}'
claude mcp add-json -s user browxai-attached "$JSON"
```

For site-docs runs against an authed target: use **`browxai-attached`** once Step 3's `capture-auth --cdp http://localhost:9222` Chrome is up — same authed session, no second login. Use plain `browxai` for ad-hoc public-site discovery where no `--cdp` Chrome exists.

**Configure `BROWX_TEST_ATTRIBUTES` for your target's codebase.** Comma-separated, **order-sensitive, first match wins** — put the most-trusted convention first. Default if unset: `data-testid,data-test,data-cy,data-qa`. If the target codebase anchors interactivity on a non-standard attribute, add it (e.g. the target app uses `data-type` rather than `data-testid` on most interactive elements — its config would be `data-testid,data-type,data-test,data-cy,data-qa`). This flag flows through a11y enrichment, the DOM walk, `selectorHint` tier-1 emission, and locator resolution. Tier-1 doesn't gate on a `role` wrapper — a `<div data-type="x">` gets `stability: "high"` directly with hint `[data-type="x"]`.

**Canonical browxai-operational reference.** Snapshot output legend (`stats:` block, `warnings:`, `[from-dom]` / `[from-both]` markers), locator-disambiguation idioms (`:visible`, `nth-match` for hidden-duplicate testids), `stability` semantics (snapshot-disambiguator vs deploy-stable — content-keyed IDs come back `stability: "high"` and need rewriting before they go into a flow-file), `find()`-query-matching surface (name + role + test-attribute *values*; icon-only `title="…"` tabs need keyword reframing), and any other operational gotchas live in **`<browxai>/AGENT-RUNBOOK.md`** — site-docs doesn't duplicate that content. Read it before driving a fresh calibration; it's the single source of truth for "how to actually use the tools."

**Adoption status.** First adoption (2026-05-13) and re-adoption (2026-05-15) both ran against the target app. Round-1 → round-2 Phase-1.5 fixes (DOM walk, `BROWX_TEST_ATTRIBUTES`, tier-1-no-role-gate, low-content warning); round-3 verdict was a WIN — one new flow calibrated entirely through `browxai-attached`, replay determinism through `site-docs run` intact. **Phase 1 closed both sides.** Five non-architectural follow-on asks (#12–#16) tracked in [`docs/browxai-asks.md`](browxai-asks.md) and browxai's `AGENT-RUNBOOK.md`; none gates adoption against new targets.

**Fallbacks if browxai itself misbehaves on a specific page:** **(a)** `site-docs inspect "$WORKSPACE" --cdp http://localhost:9222 --wait-for '<a-testid-that-mounts-when-ready>'` attaches to the same `--cdp` Chrome and settles before the snapshot (or `--wait <ms>`); without `--cdp`/`--wait` it launches a fresh headless browser with the cached session and snapshots *immediately*, which on a slow SPA catches the page pre-hydration; **(b)** drive the `--cdp` Chrome with Playwright directly (`chromium.connectOverCDP('http://localhost:9222')` → full Playwright API, persistent). *Legacy:* the original 2026-05-11 BYOB decision named Anthropic's **Claude in Chrome** extension as the discovery driver; it still works in a Claude-Code-driven session but is Claude-locked, isn't the canonical path, and shouldn't be reached for ahead of browxai. Note: when the `--cdp` Chrome is launched with `--load-extension=…/Claude`, the extension *files* load but the Claude-in-Chrome MCP tools stay paired to your host session's Chrome — they don't auto-attach to the new instance; browxai (and Playwright-over-CDP) cover the discovery need there. Prefer `success` assertions on **content that only appears in the target state** (e.g. `text_contains: { selector: 'body', text: 'Mandarin' }`) over structural selectors that may match stale/hidden poppers.

**Locator gotchas worth pre-empting.** When a `data-*` attribute might bind to a *hidden duplicate* in the DOM (Playwright's strict-mode match can pick the phantom — a click then retries 30s for a bbox), scope with `:visible` (`[data-foo="bar"]:visible`) or use a role/text selector. When a step's action **transitions the UI** — i.e. the action target gets unmounted as a new state mounts — the annotation's halo would have nothing to anchor to: give the annotation a `target` override pointing at an element that *does* exist in the resulting state — `annotation: { copy: "<what you want to say>", arrow: top, target: $appearing_element }`. (Default `annotation.target` = the step's `target`; setting it decouples the *halo anchor* from the *action target*.) If a step *halts*, a screenshot of the moment is written to **`docs/<flow>/halts/<step>.png`** (its path is in the error message) — open that first; it'll usually tell you in seconds what a 30-second timeout couldn't.

## Step 5 — run, view

```bash
site-docs run "$WORKSPACE"                  # headless Chromium; uses .auth/<role>.json; replays flows; refreshes docs/<flow>/annotations.json + screenshots
site-docs render "$WORKSPACE"               # builds $WORKSPACE/.viewer/index.html
# open "$WORKSPACE/.viewer/index.html"
```

If `run` halts on a step (a locator or success-criterion failure) that's *drift*, not a flake — don't retry blindly; report the failing step id + what changed, and propose a minimal flow-file edit (the `diagnose` playbook is `$TOOL_REPO/packages/plugin/skills/diagnose/SKILL.md`). Genuine flakiness → add async primitives (`wait_for: network_idle` / `element_stable` / a timeout) to the flow-file, documented inline.

## Step 6 — tear down, verify clean

```bash
# stop the dev server
git -C "$APP_REPO" worktree remove --force "$APP_RUN"
git -C "$APP_REPO" status        # MUST be clean. If not, you broke the no-trace contract — fix it.
# the workspace ($WORKSPACE) is yours to keep or `rm -rf`.
```

## Caveats to surface to the human

- The agent-driven calibration *pipeline stages* (the MCP-server loop where you'd call engine stage functions and resolve ambiguities against the live page) aren't built — step 4 for loose prose is a manual flow-file authoring task following the playbook. The deterministic `init`/`calibrate`(structured)/`run`/`render`/`capture-auth` are real.
- `claude plugin install` from a monorepo subdir (`$TOOL_REPO/packages/plugin`) isn't validated yet — if it doesn't register, use the CLIs + the playbook files directly.
- `manual-capture` sessions are short (≈ the app's auth-cookie lifetime). Pin `cache.auth_cookie` (Step 3) so the cache's expiry tracks the real cookie rather than the `ttl` guess. A callable login / test-only login endpoint on the app would make `run` unattended; absent that, expect to re-`capture-auth` (re-login) periodically.
- HTTPS dev certs: `--ignore-https-errors` (already baked into `.site-docs.json` if you passed it to `init`) accepts them. The app may also need gitignored files (`.env`, a dev-cert dir) copied into the worktree to boot (Step 2).
- The dev server may bind a different port than expected if the default's taken — use the URL it actually prints (Step 2).
