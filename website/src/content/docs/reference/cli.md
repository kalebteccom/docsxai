---
title: CLI
description: The full site-docs command reference - every command, every flag, and the operational notes that ship in the CLI's own help text, rendered per command.
---

This page is generated from the engine source (the usage text `site-docs
--help` prints); flag spellings are exact. The binary is `site-docs` - the
packages are named `@kalebtec/docsxai-*`, the command is not.

## Synopsis

```
site-docs init <workspace-dir> [--app-url <url>] [--auth manual-capture|none] [--role <name>] [--ttl <dur>]
                               [--capture-trigger console|button] [--auth-cookie <name>] [--ignore-https-errors]
                               [--persist tmp] [--force]
site-docs calibrate <workspace-dir> --from <flow.md|.yaml> [--name <flow>]
site-docs inspect <workspace-dir> [--url <url>] [--selector <css>] [--cdp <endpoint>] [--wait <ms>] [--wait-for <css>] [--headed] [--role <role>]
site-docs run <workspace-dir> [--flow <name>] [--base-url <url>] [--headed] [--ignore-https-errors] [--stop-after <step-id>] [--start-from <step-id>] [--cdp <endpoint>] [--pause] [--concurrency <N>]
site-docs lint <workspace-dir> [--flow <name>] [--format text|json]
site-docs flow-tree <workspace-dir> [--format text|json]
site-docs diagnose <workspace-dir> --flow <name> --step <step-id> [--cdp <endpoint>] [--format text|json]
site-docs style <workspace-dir> [--check] [--format text|json]
site-docs zip <workspace-dir> [--out <output.zip>] [--include-viewer]
site-docs baseline <workspace-dir> [--out <dir>]
site-docs diff <workspace-dir> [--against <dir>] [--format json|md|text] [--fail-on warn|fail]
site-docs export adf <workspace-dir> [--flow <name>] [--mode single|page-tree] [--title <text>] [--out <dir>]
site-docs export playwright <workspace-dir> [--flow <name>] [--out <dir>]
site-docs plugins <list|info|sync> <workspace-dir> [<namespace>] [--format text|json]
site-docs login --backend-url <url>
site-docs push <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
site-docs pull <workspace-dir> [--rev <id>]
site-docs render <workspace-dir>
site-docs capture-auth <workspace-dir> [--base-url <url>] [--role <role>] [--auth-cookie <name>] [--cdp <endpoint>] [--fresh] [--headless] [--ignore-https-errors]
site-docs --help
```

A *workspace* (created by `init`) holds `flows/<flow>.flow.yaml`, `docs/`,
`auth/strategy.yaml`, `.auth/`, `.viewer/`, and a `.site-docs.json` config.
Put it OUTSIDE the app's source repo - site-docs documents a running app from
outside and never writes into the app repo. `run` and `capture-auth` read
`app_url` and `ignore_https_errors` from `.site-docs.json` if you do not pass
the flags, and `--ignore-https-errors` accepts self-signed or invalid TLS
(an app's local HTTPS dev cert, say).

## The core loop

### `site-docs init`

Scaffolds the workspace: `flows/`, `docs/`, `auth/`, `.auth/`, `.viewer/`, a
`.gitignore`, a `README.md`, `auth/strategy.yaml`, and `.site-docs.json`
(holding `app_url` plus `ignore_https_errors` so later commands need no
flags). `--auth` must be `manual-capture` or `none`; `--ttl <dur>` sets the
session-cache fallback expiry (`30m`, `1h`); `--capture-trigger` picks
between the devtools-console capture call and an injected on-page button;
`--auth-cookie <name>` pins the cache expiry to a named cookie up front. For
a fully ephemeral workspace use `--persist tmp` (it prints the temp dir);
`--force` re-inits over an existing directory.

### `site-docs capture-auth`

Runs the role's auth strategy (for `manual-capture`: a headed, instrumented
browser the engineer logs into; `window.__siteDocs.capture()` or an injected
button snapshots the session) and caches it to
`<workspace-dir>/.auth/<role>.json` for subsequent runs. It prints the
captured cookie jar so you can identify the app's real auth/session cookie.

It keeps a persistent Chrome profile at `<workspace>/.auth/chrome-profile/`
(gitignored) - re-running it reuses the login; just trigger capture again.
`--fresh` forces a clean profile (a fresh login). `--cdp <endpoint>` makes it
*attach to an already-running Chrome* (start it with
`--remote-debugging-port=N --disable-web-security --user-data-dir=<dir>`)
instead of launching one - use this to capture from the same Chrome the
engineer is already logged into, so they do not log in twice; site-docs will
not close that Chrome, and `--cdp` ignores `--fresh`. `--headless` skips the
headed window for strategies that do not need one.

`auth_cookie` (set via `init --auth-cookie`, `capture-auth --auth-cookie`, or
hand-edited into `auth/strategy.yaml`) names the app's session cookie; when
set, the cached session's expiry tracks *that* cookie's expiry rather than
the `ttl` guess. An interactive SSO login leaves ephemeral IdP scratch
cookies, so the minimum cookie expiry is roughly "now" and must not be
trusted. If unset or unfound, `ttl` (or a 1h default) is used.

### `site-docs calibrate`

Takes a *structured flow-guide* (a flow-file in YAML, or a `.md` with a
`yaml` fenced block) and writes `flows/<name>.flow.yaml` plus a default
`docs/style.yaml`. Loose-prose descriptions and live element-picking need the
host agent - that is the plugin's calibrate skill, which then produces the
flow-file; this CLI command covers only the deterministic structured-input
case. `--name <flow>` overrides the flow name.

### `site-docs inspect`

Opens the app in a headless (or `--headed`) browser *with the cached session
loaded* and prints the page's `[data-testid]` elements, marking which are
visible - or, with `--selector <css>`, the matching elements' HTML. Use it to
pin locators when hand-authoring a flow-file: the captured session cannot be
replayed in a browser your agent's MCP controls because the auth cookie is
usually httpOnly, and `inspect` does the storageState-to-Playwright bridge
for you. On a slow SPA, settle before the snapshot with `--wait <ms>`
(default 800) or `--wait-for '<css>'`. `--url <url>` inspects a sub-page;
`--cdp <endpoint>` attaches to an already-running Chrome (the one from
`capture-auth --cdp`, say) instead of launching; `--role <role>` picks which
cached session to load.

### `site-docs run`

Executes flows headless and emits annotations plus screenshots. It launches
Chromium; if no browser binary is present, install one with
`npx playwright install chromium`. `--flow <name>` restricts to one flow;
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
  `--remote-debugging-port=N`) instead of launching one; site-docs will not
  close that Chrome. When `--cdp` is set, the cached storageState is NOT
  loaded into the context - the operator's Chrome owns its auth state.
- `--concurrency <N>` runs up to N flows in parallel, each in its own
  isolated Chromium session (default 1). Useful when several flows share a
  long preamble: total wall time is the longest flow, not the sum.
  Force-clamped to 1 when `--pause`, `--stop-after`, `--start-from`, or
  `--cdp` is set. The target app must tolerate multiple sessions from one
  user.

### `site-docs render`

Builds the static viewer by spawning the `docsxai-viewer` bin, resolved in
order: the `SITE_DOCS_VIEWER_BIN` env var (path to the viewer's bin script),
the `@kalebtec/docsxai-viewer` package installed next to the engine, then
`docsxai-viewer` on PATH. A launch failure reports all three attempts.

## Calibration aids

### `site-docs lint`

Pure-static checks across the workspace's flow-files - no Playwright, no
live page. The core rules cover deep `extends` chains, annotations anchored
to likely-unmounting click/navigate targets, selector waits with no
`timeout_ms` on long-async-looking steps, bare `[data-*=...]` selectors
prone to hidden duplicates, and more - the full R001-R010 table is in
[Troubleshooting](/guides/troubleshooting/). Workspace plugins can add
rules. Exit 1 if any warning or error; `--format json` emits
machine-readable output for tooling.

### `site-docs flow-tree`

Prints the workspace's `extends` graph (root flows and their descendants),
plus any orphans (flows whose `extends` parent is not in the workspace) and
resolution issues (cycles, step-id collisions across the merge). Pure-static.
Exit 1 if any issues.

### `site-docs diagnose`

Gathers halt context for a specific step: the step's selector, `wait_for`,
and `success`, the halt screenshot if one exists, and - with `--cdp` - a
live `actionable()` probe of the target on the running page. Prints typed
recommendations (`selector` / `wait_for` / `success` / `annotation_target` /
`split_step` / `investigate`). The engine never patches the flow-file itself;
that is the agent's explicit opt-in action. `--format json` emits
machine-readable output for an agent to act on. Pair with
`run --start-from <step-id> --cdp` to validate the fix in seconds.

### `site-docs style`

Initialises `docs/style.yaml` plus the derived `docs/style.json` if absent;
otherwise validates the existing YAML against the schema and rederives the
JSON. `--check` additionally scans every `docs/<flow>/<step>.md` user-facing
write-up for jargon leaks against the style's `pruning_rules` (VERIFY, WAIT,
`data-testid` leaking into user-facing prose, say). The engine never
re-shapes prose itself; the agent does that at calibration time - this
command is the enforcement layer. `--format json` for tooling.

## Drift detection

### `site-docs baseline`

Snapshots the doc pack - `flows/`, `docs/<flow>/*.md`, `annotations.json`,
`screenshots/`, and `docs/locators.yaml` - into `<ws>/.baseline/` (or
`--out <dir>`). Commit the baseline: it is the "before" that `diff` compares
against in CI. Refresh replaces the previous snapshot whole, so stale
leftovers never read as drift.

### `site-docs diff`

Compares the workspace against a baseline (default `<ws>/.baseline/`, or
`--against <dir>`) and emits a deterministic drift report: per flow, step
field deltas (id-keyed), annotation moves, screenshot pixel diffs
(changed-pixel count, percentage, changed-region bounding box; dimension
changes flagged distinctly), prose line-change counts, and locator changes.
`--format md` is PR-comment-ready. `--fail-on warn|fail` exits 1 when the
report severity is at or above the threshold (screenshot severity: at least
1% changed pixels is warn, at least 5% is fail; structural changes are
warn).

## Packaging and export

### `site-docs zip`

Packages the workspace's doc pack into a single archive for hand-off.
Includes `flows/`, `docs/`, `.site-docs.json`, `auth/strategy.yaml` (env-var
names only, no creds), `README.md`. Excludes `.auth/` (operator-local
session state), `**/halts/` (debug screenshots), and `.viewer/` by default
(re-renderable from the pack; pass `--include-viewer` to bundle it). Defaults
output to `<workspace-name>.zip` in the current dir; override with
`--out <path>`. Zips in-process (no system `zip` binary needed) and
deterministically - sorted entries, fixed mtime, fixed compression - so the
same doc pack always produces a byte-identical archive.

### `site-docs export adf`

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

### `site-docs export playwright`

Emits one self-contained Playwright `.spec.ts` per flow (`extends` resolved)
into `<ws>/.export/tests/` (or `--out <dir>`): locators as consts, steps as
page actions, success criteria as `expect()` assertions, `environment` as
`test.use()`; optional steps are try/catch-wrapped. Generated files say so in
a header: regenerate, do not hand-edit.

## Plugins

### `site-docs plugins list | info | sync`

The workspace plugin runtime surface: `list` prints the status table (loaded
or disabled, with reasons; exit 1 if any plugin is not loaded), `info
<namespace>` prints a plugin's manifest plus registered artifact names, and
`sync` (re)writes `plugins-lock.json` with each plugin's register-module
sha256 - without ever executing plugin code. All three accept `--format
json`. Field-by-field detail is in the [plugins reference](/reference/plugins/).

## Backend

### `site-docs login`

Validates a bearer token against a backend URL - hits `/v1/health` and
`/v1/workspaces`. Reads the token from the `SITE_DOCS_TOKEN` env var; prints
what the backend sees on success, or a clear error. Stateless: it stores
nothing. With `--oauth <workspace-dir>` it instead drives the full OAuth 2.1
authorization-code + PKCE handshake against the backend and stores the tokens
at `<workspace>/.auth/backend-token.json` (mode 0600); `push`, `pull`, and
`run` pick them up from there.

### `site-docs push`

Serialises the workspace's doc pack (flows, annotations, screenshots, style,
locators) and POSTs it as a new revision against the backend named in
`.site-docs.json` (`backend_url`, plus optionally `backend_workspace_id` /
`backend_project_id` - created on first push if absent and persisted back to
the config). Screenshot bytes travel as content-addressed blobs, HEAD-probed
so unchanged PNGs are skipped. `--kind` defaults to `calibrate`; `--author`
defaults to the OS user. The revision is finalized after upload - a sealed,
immutable snapshot.

### `site-docs pull`

Fetches a revision's artifacts back into the workspace files (default:
`head`; `--rev <id>` for a named revision). Useful for syncing with a
different operator's edits or rolling back. Fetched screenshot blobs are
verified against their sha256 before they touch disk.

The endpoint surface behind `login`/`push`/`pull` is documented in the
[backend API reference](/reference/backend-api/).
