---
title: CLI
description: The full docsxai command reference - every command, every flag, and the operational notes that ship in the CLI's own help text, rendered per command.
---

This page is generated from the engine source (the usage text `docsxai
--help` prints); flag spellings are exact. The binary is `docsxai` - the
packages are named `@docsxai/*`, the command is not.

## Synopsis

```
docsxai init <workspace-dir> [--app-url <url>] [--auth manual-capture|none] [--role <name>] [--ttl <dur>]
                               [--capture-trigger console|button] [--auth-cookie <name>] [--ignore-https-errors]
                               [--persist tmp] [--force]
docsxai calibrate <workspace-dir> --from <flow.md|.yaml> [--name <flow>]
docsxai inspect <workspace-dir> [--url <url>] [--selector <css>] [--cdp <endpoint>] [--wait <ms>] [--wait-for <css>] [--headed] [--role <role>]
docsxai run <workspace-dir> [--flow <name>] [--base-url <url>] [--headed] [--ignore-https-errors] [--stop-after <step-id>] [--start-from <step-id>] [--cdp <endpoint>] [--pause] [--concurrency <N>]
docsxai lint <workspace-dir> [--flow <name>] [--format text|json]
docsxai flow-tree <workspace-dir> [--format text|json]
docsxai diagnose <workspace-dir> --flow <name> --step <step-id> [--cdp <endpoint>] [--format text|json]
docsxai doctor [<workspace-dir>]
docsxai style <workspace-dir> [--check] [--format text|json]
docsxai zip <workspace-dir> [--out <output.zip>] [--include-viewer]
docsxai baseline <workspace-dir> [--out <dir>]
docsxai diff <workspace-dir> [--against <dir>] [--format json|md|text] [--fail-on warn|fail]
docsxai export adf <workspace-dir> [--flow <name>] [--mode single|page-tree] [--title <text>] [--out <dir>]
docsxai export playwright <workspace-dir> [--flow <name>] [--out <dir>]
docsxai plugins <list|info|sync> <workspace-dir> [<namespace>] [--format text|json]
docsxai login --backend-url <url>
docsxai push <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
docsxai pull <workspace-dir> [--rev <id>]
docsxai render <workspace-dir>
docsxai capture-auth <workspace-dir> [--base-url <url>] [--role <role>] [--auth-cookie <name>] [--cdp <endpoint>] [--fresh] [--headless] [--ignore-https-errors]
docsxai --help
```

A _workspace_ (created by `init`) holds `flows/<flow>.flow.yaml`, `docs/`,
`auth/strategy.yaml`, `.auth/`, `.viewer/`, and a `.docsxai.json` config.
Put it OUTSIDE the app's source repo - docsxai documents a running app from
outside and never writes into the app repo. `run` and `capture-auth` read
`app_url` and `ignore_https_errors` from `.docsxai.json` if you do not pass
the flags, and `--ignore-https-errors` accepts self-signed or invalid TLS
(an app's local HTTPS dev cert, say).

Every command exits 0 on success. Validation problems (a missing argument, a
bad flag value) exit 2; operational failures (a halt, a lint warning, drift at
the threshold) exit 1. The transcripts below show representative output; paths
and counts vary with your workspace.

## The core loop

### `docsxai init`

Scaffolds the workspace: `flows/`, `docs/`, `auth/`, `.auth/`, `.viewer/`, a
`.gitignore`, a `README.md`, `auth/strategy.yaml`, and `.docsxai.json`
(holding `app_url` plus `ignore_https_errors` so later commands need no
flags). `--auth` must be `manual-capture` or `none`; `--ttl <dur>` sets the
session-cache fallback expiry (`30m`, `1h`); `--capture-trigger` picks
between the devtools-console capture call and an injected on-page button;
`--auth-cookie <name>` pins the cache expiry to a named cookie up front. For
a fully ephemeral workspace use `--persist tmp` (it prints the temp dir);
`--force` re-inits over an existing directory.

```
$ docsxai init ~/docsxai/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h
init: workspace at ~/docsxai/my-app
  created: flows/, docs/, auth/, .auth/, .viewer/, .gitignore, .docsxai.json, auth/strategy.yaml, README.md
  next: docsxai capture-auth ~/docsxai/my-app  →  …calibrate…  →  docsxai run ~/docsxai/my-app  →  docsxai render ~/docsxai/my-app
```

### `docsxai capture-auth`

Runs the role's auth strategy (for `manual-capture`: a headed, instrumented
browser the engineer logs into; `window.__docsxai.capture()` or an injected
button snapshots the session) and caches it to
`<workspace-dir>/.auth/<role>.json` for subsequent runs. It prints the
captured cookie jar so you can identify the app's real auth/session cookie.

It keeps a persistent Chrome profile at `<workspace>/.auth/chrome-profile/`
(gitignored) - re-running it reuses the login; just trigger capture again.
`--fresh` forces a clean profile (a fresh login). `--cdp <endpoint>` makes it
_attach to an already-running Chrome_ (start it with
`--remote-debugging-port=N --disable-web-security --user-data-dir=<dir>`)
instead of launching one - use this to capture from the same Chrome the
engineer is already logged into, so they do not log in twice; docsxai will
not close that Chrome, and `--cdp` ignores `--fresh`. `--headless` skips the
headed window for strategies that do not need one.

`auth_cookie` (set via `init --auth-cookie`, `capture-auth --auth-cookie`, or
hand-edited into `auth/strategy.yaml`) names the app's session cookie; when
set, the cached session's expiry tracks _that_ cookie's expiry rather than
the `ttl` guess. An interactive SSO login leaves ephemeral IdP scratch
cookies, so the minimum cookie expiry is roughly "now" and must not be
trusted. If unset or unfound, `ttl` (or a 1h default) is used.

```
$ docsxai capture-auth ~/docsxai/my-app --auth-cookie session
capture-auth: launching browser for role "editor" (manual-capture) — reusing saved profile if present; log in if prompted, then trigger capture…
capture-auth: captured 9 cookie(s) (newest expiry first):
    _ga  @localhost  expires 2027-07-12T16:40:08.000Z
    session  @localhost  expires 2026-06-12T17:40:11.000Z
    csrf_token  @localhost  expires (session)
capture-auth: cached editor → ~/docsxai/my-app/.auth/editor.json
  expires 2026-06-12T17:40:11.000Z  (from auth-cookie "session"; re-run when it lapses)
```

If the expiry line says `(from ttl)` instead, the named cookie was not in the
jar - pick the app's real session cookie from the printed list and re-run.

### `docsxai calibrate`

Takes a _structured flow-guide_ (a flow-file in YAML, or a `.md` with a
`yaml` fenced block) and writes `flows/<name>.flow.yaml` plus a default
`docs/style.yaml`. Loose-prose descriptions and live element-picking need the
host agent - that is the plugin's calibrate skill, which then produces the
flow-file; this CLI command covers only the deterministic structured-input
case. `--name <flow>` overrides the flow name.

```
$ docsxai calibrate ~/docsxai/my-app --from ./guides/publish-post.md
calibrate: wrote ~/docsxai/my-app/flows/publish-post.flow.yaml  (5 steps)
calibrate: wrote default ~/docsxai/my-app/docs/style.yaml
  next: docsxai run ~/docsxai/my-app  (then: docsxai render ~/docsxai/my-app)
```

### `docsxai inspect`

Opens the app in a headless (or `--headed`) browser _with the cached session
loaded_ and prints the page's `[data-testid]` elements, marking which are
visible - or, with `--selector <css>`, the matching elements' HTML. Use it to
pin locators when hand-authoring a flow-file: the captured session cannot be
replayed in a browser your agent's MCP controls because the auth cookie is
usually httpOnly, and `inspect` does the storageState-to-Playwright bridge
for you. On a slow SPA, settle before the snapshot with `--wait <ms>`
(default 800) or `--wait-for '<css>'`. `--url <url>` inspects a sub-page;
`--cdp <endpoint>` attaches to an already-running Chrome (the one from
`capture-auth --cdp`, say) instead of launching; `--role <role>` picks which
cached session to load.

```
$ docsxai inspect ~/docsxai/my-app
inspect: https://localhost:3000/dashboard
  title: Acme · Dashboard
  4 [data-testid] element(s) (✓ = visible) — pin these as locators:
    ✓ [data-testid="nav-reports"]  <a>  "Reports"
    ✓ [data-testid="nav-account"]  <a>  "Account"
    ✓ [data-testid="new-post"]  <button>  "New post"
      [data-testid="upgrade-dialog"]  <div>  "Upgrade to Pro"
```

### `docsxai run`

Executes flows headless and emits annotations plus screenshots. It launches
Chromium; if no browser binary is present, install one with
`npx playwright-core install chromium` (from a source checkout:
`pnpm -C packages/engine exec playwright-core install chromium`).
`--flow <name>` restricts to one flow;
`--base-url <url>` overrides the workspace's `app_url`.

- `--stop-after <step-id>` runs only a prefix of the flow (up to and
  including that step); `--pause` keeps the (headed) browser open at the last
  step run, so you can inspect the live state mid-flow when calibrating
  (pair with `--flow <name>`). For a slow backend op, give a step a
  `wait_for` of the form `{ selector: $x, timeout_ms: 180000 }` - a per-step
  override of the default ~30s selector-wait timeout.
- `--start-from <step-id> --flow <name>` SKIPS every step before
  `<step-id>` and starts execution there - the inverse of `--stop-after`.
  Pair with `--cdp` to attach to a Chrome already in the post-prior-steps
  state (left over from a paused previous run, say) and iterate on a new
  tail step in seconds rather than re-walking the whole `extends` chain. New
  annotations MERGE into the existing `annotations.json` by step id; prior
  steps' annotations and screenshots are preserved.
- `--cdp <endpoint>` attaches to a running Chrome (start it with
  `--remote-debugging-port=N`) instead of launching one; docsxai will not
  close that Chrome. When `--cdp` is set, the cached storageState is NOT
  loaded into the context - the operator's Chrome owns its auth state.
- `--concurrency <N>` runs up to N flows in parallel, each in its own
  isolated Chromium session (default 1). Useful when several flows share a
  long preamble: total wall time is the longest flow, not the sum.
  Force-clamped to 1 when `--pause`, `--stop-after`, `--start-from`, or
  `--cdp` is set. The target app must tolerate multiple sessions from one
  user.

A clean run prints one line per flow and exits 0:

```
$ docsxai run ~/docsxai/my-app --flow publish-post
publish-post — 5 step(s) executed, 4 annotation(s) written
```

A halted run names the step, the inferred cause, and the halt screenshot,
then exits 1 - hand that to [`diagnose`](#docsxai-diagnose) rather than
retrying:

```
$ docsxai run ~/docsxai/my-app --flow publish-post
[target is covered by another element] step "publish" (click) failed at
https://localhost:3000/editor/draft-7: … (halt screenshot: docs/publish-post/halts/publish.png)
```

:::caution[For agents]
A halt replays identically on a retry - the engine has no retry-until-green.
The productive loop is `diagnose` → edit the flow-file →
`run --start-from <step-id> --cdp <endpoint>` to validate the fix in seconds
instead of re-walking the flow. See the
[agent guidance](/guides/agent-guidance/#diagnose-after-a-halt-never-blind-retries).
:::

### `docsxai render`

Builds the static viewer by spawning the `docsxai-viewer` bin, resolved in
order: the `DOCSX_VIEWER_BIN` env var (path to the viewer's bin script),
the `@docsxai/viewer` package installed next to the engine, then
`docsxai-viewer` on PATH. A launch failure reports all three attempts.

```
$ docsxai render ~/docsxai/my-app
render: open ~/docsxai/my-app/.viewer/index.html  (the index links the flows; each flow page
shows the screenshots — hover a pulsing halo to read its callout)
```

## Calibration aids

### `docsxai lint`

Pure-static checks across the workspace's flow-files - no Playwright, no
live page. The core rules cover deep `extends` chains, annotations anchored
to likely-unmounting click/navigate targets, selector waits with no
`timeout_ms` on long-async-looking steps, bare `[data-*=...]` selectors
prone to hidden duplicates, and more - the full R001-R010 table is in
[Troubleshooting](/guides/troubleshooting/). Workspace plugins can add
rules. Exit 1 if any warning or error; `--format json` emits
machine-readable output for tooling.

```
$ docsxai lint ~/docsxai/my-app
flow publish-post
  R004 [info] step 'open-editor': selector `[data-testid="new-post"]` is a bare `[data-*=…]` match — may resolve to multiple DOM nodes (visible + hidden duplicate)
    → scope it: `[data-testid="new-post"]:visible` or add a `:has-text(…)` qualifier
  R007 [warning] step 'confirm-live': terminal step has no `success` criterion

0 errors, 1 warning, 1 info
$ echo $?
1
```

### `docsxai flow-tree`

Prints the workspace's `extends` graph (root flows and their descendants),
plus any orphans (flows whose `extends` parent is not in the workspace) and
resolution issues (cycles, step-id collisions across the merge). Pure-static.
Exit 1 if any issues.

```
$ docsxai flow-tree ~/docsxai/my-app
preamble    [3 steps]
├── publish-post    [5 steps]
└── invite-user    [4 steps]

3 flows, max chain depth 1
```

### `docsxai diagnose`

Gathers halt context for a specific step: the step's selector, `wait_for`,
and `success`, the halt screenshot if one exists, and - with `--cdp` - a
live `actionable()` probe of the target on the running page. Prints typed
recommendations (`selector` / `wait_for` / `success` / `annotation_target` /
`split_step` / `investigate`). The engine never patches the flow-file itself;
that is the agent's explicit opt-in action. `--format json` emits
machine-readable output for an agent to act on. Pair with
`run --start-from <step-id> --cdp` to validate the fix in seconds.

```
$ docsxai diagnose ~/docsxai/my-app --flow publish-post --step publish --cdp http://localhost:9222
diagnose: flow=publish-post step=publish

Current step:
  action: click
  target: $publish_button (resolved: [data-testid="publish"])
  wait_for: {"selector":"$live_banner","timeout_ms":120000}
  success: {"visible":"$live_banner"}

Halt artifacts:
  screenshot: docs/publish-post/halts/publish.png

Live probe (via http://localhost:9222):
  url: https://localhost:3000/editor/draft-7
  actionable: covered
  bbox: {"x":1184,"y":24,"width":96,"height":36}

Recommendations (1):
  [wait_for] the live probe reports the target covered — another element receives the click
    → wait out (or dismiss, via a prior optional step) the covering element before this click
```

### `docsxai doctor`

Health-checks the environment and the workspace, browxai-style: a `✓`/`✗`
checklist with a one-line fix per failing row (`−` rows are informational and
never fail). The checks: Node >= 20, a Chromium binary for playwright-core,
`.docsxai.json` found and parseable (the argument, or the current directory),
every flow-file parses, the auth descriptor plus the cached session's
freshness, backend reachability when `backend_url` is configured (plus a
token-presence note), the plugin declarations through the same inspection
`plugins list` runs - declared/installed/lock/capabilities, with **no plugin
code executed** - viewer-bin resolution (naming which of the three layers
hit), and `DOCSX_*` env sanity (`DOCSX_CACHE_KEY` well-formed when set,
unknown `DOCSX_*` names flagged as likely typos). Exit 1 on any `✗`.

```
$ docsxai doctor ~/docsxai/my-app
docsxai doctor — environment & workspace health

  ✓ node       v22.15.0 (>= 20 required)
  ✓ chromium   ~/Library/Caches/ms-playwright/chromium-1223/…/Google Chrome for Testing
  ✓ workspace  ~/docsxai/my-app/.docsxai.json (docsxai/workspace@1, app_url https://localhost:3000)
  ✓ flows      3 flow-file(s) parse
  ✓ auth       auth/strategy.yaml ok — role(s) editor (default "editor", strategy manual-capture)
  ✗ auth       cached session for role "editor" expired 2026-06-12T11:00:00.000Z
    fix: re-capture: docsxai capture-auth ~/docsxai/my-app
  − backend    no backend_url configured — the workspace operates fully locally
  − plugins    no plugins configured (add a "plugins" array to .docsxai.json)
  ✓ viewer     @docsxai/viewer installed next to the engine → …/dist/index.js (layer 2: installed package)
  − env        no DOCSX_* variables set (defaults apply)

fix the ✗ items above
```

Run it first when anything misbehaves - it answers the usual "is it my
environment or my flow?" question in one shot, and every failing row names
its own fix.

### `docsxai style`

Initialises `docs/style.yaml` plus the derived `docs/style.json` if absent;
otherwise validates the existing YAML against the schema and rederives the
JSON. `--check` additionally scans every `docs/<flow>/<step>.md` user-facing
write-up for jargon leaks against the style's `pruning_rules` (VERIFY, WAIT,
`data-testid` leaking into user-facing prose, say). The engine never
re-shapes prose itself; the agent does that at calibration time - this
command is the enforcement layer. `--format json` for tooling.

```
$ docsxai style ~/docsxai/my-app --check
style: validated docs/style.yaml; rederived docs/style.json

2 jargon leaks:
  docs/publish-post/publish.md:3  [VERIFY/EXPECT/ASSERT directives]  VERIFY
  docs/publish-post/open-editor.md:1  [internal locator names]  data-testid
```

Exit 1 on any leak; `✓ no jargon leaks` and exit 0 when clean.

## Drift detection

### `docsxai baseline`

Snapshots the doc pack - `flows/`, `docs/<flow>/*.md`, `annotations.json`,
`screenshots/`, and `docs/locators.yaml` - into `<ws>/.baseline/` (or
`--out <dir>`). Commit the baseline: it is the "before" that `diff` compares
against in CI. Refresh replaces the previous snapshot whole, so stale
leftovers never read as drift.

```
$ docsxai baseline ~/docsxai/my-app
baseline: snapshotted 23 files to ~/docsxai/my-app/.baseline
```

### `docsxai diff`

Compares the workspace against a baseline (default `<ws>/.baseline/`, or
`--against <dir>`) and emits a deterministic drift report: per flow, step
field deltas (id-keyed), annotation moves, screenshot pixel diffs
(changed-pixel count, percentage, changed-region bounding box; dimension
changes flagged distinctly), prose line-change counts, and locator changes.
`--format md` is PR-comment-ready. `--fail-on warn|fail` exits 1 when the
report severity is at or above the threshold (screenshot severity: at least
1% changed pixels is warn, at least 5% is fail; structural changes are
warn).

```
$ docsxai diff ~/docsxai/my-app --fail-on warn
drift: ~/docsxai/my-app/.baseline → ~/docsxai/my-app
flow publish-post [WARN]
  - step publish changed: wait_for: {"selector":"$live_banner"} → {"selector":"$live_banner","timeout_ms":120000}
  - screenshot publish.png [WARN]: 2.1% pixels changed
totals: 1 flows changed, 1 steps, 1 screenshots, max pixel change 2.1%, severity warn
$ echo $?
1
```

With no drift the report is two lines (`no drift detected`) and the exit
code is 0.

## Packaging and export

### `docsxai zip`

Packages the workspace's doc pack into a single archive for hand-off.
Includes `flows/`, `docs/`, `.docsxai.json`, `auth/strategy.yaml` (env-var
names only, no creds), `README.md`. Excludes `.auth/` (operator-local
session state), `**/halts/` (debug screenshots), and `.viewer/` by default
(re-renderable from the pack; pass `--include-viewer` to bundle it). Defaults
output to `<workspace-name>.zip` in the current dir; override with
`--out <path>`. Zips in-process (no system `zip` binary needed) and
deterministically - sorted entries, fixed mtime, fixed compression - so the
same doc pack always produces a byte-identical archive.

```
$ docsxai zip ~/docsxai/my-app
zip: wrote my-app.zip (38 entries, 1843.2 KB)
```

### `docsxai export adf`

Projects the doc pack to Confluence Cloud ADF - pure and deterministic, zero
HTTP. `--mode single` (default) emits one consolidated document; `--mode
page-tree` emits a parent overview plus one document per flow; `--title
<text>` overrides the title; `--flow <name>` restricts to one flow. Output
lands in `<ws>/.export/adf/` (or `--out <dir>`) as `projection.json` plus
`attachments.json` (per-screenshot file name, source path, sha256). A host
agent hands these to the Atlassian MCP, or the
[Confluence publisher plugin](/packages/plugin-confluence/) consumes them -
all Confluence HTTP lives in that capability-declared plugin, never in the
engine.

```
$ docsxai export adf ~/docsxai/my-app --mode page-tree
export adf: wrote ~/docsxai/my-app/.export/adf/projection.json (3 documents, mode page-tree) + ~/docsxai/my-app/.export/adf/attachments.json (9 attachments)
```

### `docsxai export playwright`

Emits one self-contained Playwright `.spec.ts` per flow (`extends` resolved)
into `<ws>/.export/tests/` (or `--out <dir>`): locators as consts, steps as
page actions, success criteria as `expect()` assertions, `environment` as
`test.use()`; optional steps are try/catch-wrapped. Generated files say so in
a header: regenerate, do not hand-edit.

```
$ docsxai export playwright ~/docsxai/my-app
export playwright: wrote 3 specs to ~/docsxai/my-app/.export/tests
```

## Plugins

### `docsxai plugins list | info | sync`

The workspace plugin runtime surface: `list` prints the status table (loaded
or disabled, with reasons; exit 1 if any plugin is not loaded), `info
<namespace>` prints a plugin's manifest plus registered artifact names, and
`sync` (re)writes `plugins-lock.json` with each plugin's register-module
sha256 - without ever executing plugin code. All three accept `--format
json`. Field-by-field detail is in the [plugins reference](/reference/plugins/).

```
$ docsxai plugins list ~/docsxai/my-app
plugins (2 configured, 2 loaded):
  confluence  loaded  v0.1.0  kalebtec  publisher  package:@docsxai/plugin-confluence
  demo  loaded  v0.0.1  local  publisher  path:../my-local-plugin
```

A fuller session, including `info` and `sync`, is in the
[plugins reference](/reference/plugins/#cli).

## Backend

### `docsxai login`

Validates a bearer token against a backend URL - hits `/v1/health` and
`/v1/workspaces`. Reads the token from the `DOCSX_TOKEN` env var; prints
what the backend sees on success, or a clear error. Stateless: it stores
nothing. With `--oauth <workspace-dir>` it instead drives the full OAuth 2.1
authorization-code + PKCE handshake against the backend and stores the tokens
at `<workspace>/.auth/backend-token.json` (mode 0600); `push`, `pull`, and
`run` pick them up from there.

```
$ DOCSX_TOKEN=$CI_TOKEN docsxai login --backend-url http://127.0.0.1:4477
login: ok. 1 workspace visible at http://127.0.0.1:4477
```

### `docsxai push`

Serialises the workspace's doc pack (flows, annotations, screenshots, style,
locators) and POSTs it as a new revision against the backend named in
`.docsxai.json` (`backend_url`, plus optionally `backend_workspace_id` /
`backend_project_id` - created on first push if absent and persisted back to
the config). Screenshot bytes travel as content-addressed blobs, HEAD-probed
so unchanged PNGs are skipped. `--kind` defaults to `calibrate`; `--author`
defaults to the OS user. The revision is finalized after upload - a sealed,
immutable snapshot.

```
$ docsxai push ~/docsxai/my-app --kind run --author ci
push: screenshots — 2 blob(s) uploaded, 7 already on the backend
push: revision 1d4f0c9a-6f4e-4b9a-9a3e-7f1d2b8c5e10 (run, ci) — 5 artifact slots uploaded, finalized
```

### `docsxai pull`

Fetches a revision's artifacts back into the workspace files (default:
`head`; `--rev <id>` for a named revision). Useful for syncing with a
different operator's edits or rolling back. Fetched screenshot blobs are
verified against their sha256 before they touch disk.

```
$ docsxai pull ~/docsxai/my-app
pull: revision 1d4f0c9a-6f4e-4b9a-9a3e-7f1d2b8c5e10 (run, ci) — wrote 23 file(s)
```

The endpoint surface behind `login`/`push`/`pull` is documented in the
[backend API reference](/reference/backend-api/).
