// `docsxai` CLI help text. Split out of cli.ts so the dispatch barrel and every command cluster
// can share the one authoritative USAGE string (commands print it on a missing-arg bail; the
// barrel prints it for --help / unknown-command). Text only — no imports, the truest leaf.

export const USAGE = `docsxai — deterministic execution CLI

Usage:
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

Notes:
  • A *workspace* (created by \`init\`) holds flows/<flow>.flow.yaml, docs/, auth/strategy.yaml, .auth/, .viewer/,
    and a .docsxai.json config. Put it OUTSIDE the app's source repo — docsxai documents a running app from
    outside and never writes into the app repo.
  • run / capture-auth read app_url + ignore_https_errors from .docsxai.json if you don't pass the flags.
  • run launches Chromium; if no browser binary is present, install one:  npx playwright-core install chromium
    (source checkout: pnpm -C packages/engine exec playwright-core install chromium)
  • --ignore-https-errors accepts self-signed/invalid TLS (e.g. an app's local HTTPS dev cert)
  • run --stop-after <step-id> runs only a prefix of the flow (up to & incl. that step); --pause keeps the
    (headed) browser open at the last step run — so you can inspect the live state mid-flow when calibrating
    (pair with --flow <name>). For waiting on a slow backend op, give a step a wait_for of the form
    { selector: $x, timeout_ms: 180000 } — a per-step override of the default ~30s selector-wait timeout.
  • run --concurrency <N> runs up to N flows in parallel (each its own Chromium session, isolated; default 1).
    Useful when several flows share a long preamble — total wall time = max(per-flow), not sum. Force-clamped
    to 1 when --pause / --stop-after / --start-from / --cdp is set. The target app must tolerate multiple sessions from one user.
  • run --start-from <step-id> --flow <name> SKIPS every step before <step-id> and starts execution there —
    the inverse of --stop-after. Pair with --cdp to attach to a Chrome that's already in the post-prior-steps
    state (e.g. left over from a paused previous run) and iterate on the new tail step in seconds rather
    than re-walking the whole extends chain. New annotations MERGE into the existing annotations.json by
    step id; the prior steps' annotations and screenshots are preserved.
  • run --cdp <endpoint> attaches to a running Chrome (start it with --remote-debugging-port=N) instead of
    launching one. docsxai won't close that Chrome. When --cdp is set, the cached storageState is NOT
    loaded into the context — the operator's Chrome owns its auth state. Useful with --start-from for the
    sub-3-sec iteration loop on long-async flows.
  • capture-auth runs the role's auth strategy (MVP: manual-capture — a headed, instrumented browser the
    engineer logs into; window.__docsxai.capture() or an injected button snapshots the session) and caches
    it to <workspace-dir>/.auth/<role>.json for subsequent \`run\`s. It prints the captured cookie jar so you
    can identify the app's real auth/session cookie.
  • capture-auth keeps a persistent Chrome profile at <workspace>/.auth/chrome-profile/ (gitignored) — re-running
    it reuses the login (just trigger capture again). Use --fresh for a clean profile (forces a fresh login).
  • --cdp <endpoint> makes capture-auth *attach to an already-running Chrome* (start it with
    --remote-debugging-port=N --disable-web-security --user-data-dir=<dir>) instead of launching a fresh one —
    use this to capture from the same Chrome the engineer is already logged into (and that Claude in Chrome is
    driving for discovery), so they don't log in twice. docsxai won't close that Chrome. (--cdp ignores --fresh.)
  • auth_cookie (set via \`init --auth-cookie\`, \`capture-auth --auth-cookie\`, or hand-edited into
    auth/strategy.yaml) names that cookie; when set, the cached session's expiry tracks *that* cookie's
    expiry rather than the \`ttl\` guess (an interactive SSO login leaves ephemeral IdP scratch cookies, so
    \`min(cookie.expires)\` ≈ now — don't rely on it). If unset/unfound, \`ttl\` (or a 1h default) is used.
  • inspect opens the app in a headless (or --headed) browser *with the cached session loaded* and prints the
    page's [data-testid] elements (or, with --selector, matching elements' HTML) — for pinning locators when
    hand-authoring a flow-file (the captured session can't be replayed in a browser the agent's MCP controls
    because the auth cookie is usually httpOnly; inspect does the storageState→Playwright bridge for you). On a
    slow SPA, settle before the snapshot with --wait <ms> (default 800) or --wait-for '<css>'. --cdp <endpoint>
    attaches to an already-running Chrome (e.g. the one from capture-auth --cdp) instead of launching one.
  • calibrate takes a *structured flow-guide* (a flow-file in YAML, or a .md with a yaml fenced block) and
    writes flows/<name>.flow.yaml + a default docs/style.yaml. Loose-prose descriptions / live element-picking
    need the host agent — that's the /docsxai:calibrate *skill* (see the plugin), which then refines/produces
    the flow-file; this CLI command covers only the deterministic structured-input case.
  • lint runs pure-static checks across the workspace's flow-files — no Playwright, no live page. Rules:
    R001 (deep extends chain), R002 (annotation anchored to a likely-unmounting click/navigate target —
    suggest annotation.target override), R003 (wait_for with no timeout_ms on a long-async-looking step),
    R004 (bare [data-*=…] selector — may have hidden duplicates; suggest :visible / :has-text qualifier).
    Exit 1 if any warning/error; 0 otherwise. --format json emits machine-readable output for tooling.
  • flow-tree prints the workspace's extends graph (root flows + their descendants), plus any orphans
    (flows whose extends parent isn't in the workspace) and resolution issues (cycles / step-id collisions
    across the merge). Pure-static, ~no I/O beyond reading the flow files. Exit 1 if any issues.
  • diagnose gathers halt context for a specific step (the step's selector/wait_for/success, the halt
    screenshot if one exists, and — with --cdp — a live actionable() probe of the target on the running
    page) and prints recommendations (selector / wait_for / success / annotation_target / split_step /
    investigate). The engine never patches the flow-file itself — that's the agent's explicit opt-in
    action. --format json emits machine-readable output for an agent to act on. Pair with
    --start-from <step-id> --cdp on a follow-up run to validate the fix in seconds.
  • doctor health-checks the environment + workspace: Node >= 20, Chromium presence, .docsxai.json
    found + parseable (cwd or the arg), flow-file parses, auth descriptor + cached-session freshness,
    backend reachability (when backend_url is set), the plugin declarations (same inspection as
    \`plugins list\` — no plugin code is executed), viewer-bin resolution (which of the three layers
    hit), and DOCSX_* env sanity. ✓/✗ rows with a one-line fix per failure; − rows are informational
    and never fail. Exit 1 if any ✗.
  • style initialises docs/style.yaml + derived docs/style.json if absent (otherwise validates the
    existing YAML against the schema and rederives the JSON). --check additionally scans every
    docs/<flow>/<step>.md user-facing write-up for jargon leaks against the style's pruning_rules
    (e.g. VERIFY / WAIT / data-testid leaking into user-facing prose). The engine never re-shapes
    prose itself (LLM-agnostic) — the agent does that at calibration time; this command is the
    enforcement layer for the semantic-reshape exit criterion. --format json emits machine-readable
    output for tooling.
  • zip packages the workspace's doc pack into a single archive for hand-off. Includes flows/, docs/,
    .docsxai.json, auth/strategy.yaml (env-var names only, no creds), README.md. Excludes .auth/
    (operator-local session state), **/halts/ (debug screenshots), .viewer/ by default (re-renderable
    from the doc pack; pass --include-viewer to bundle it). Defaults output to <workspace-name>.zip
    in the current dir; override with --out <path>. Zips in-process (no system 'zip' binary needed)
    and deterministically — sorted entries, fixed mtime, fixed compression — so the same doc pack
    always produces a byte-identical archive.
  • baseline snapshots the doc pack — flows/, docs/<flow>/*.md, annotations.json, screenshots/, and
    docs/locators.yaml — into <ws>/.baseline/ (or --out <dir>). Commit the baseline: it's the "before"
    that diff compares against in CI.
  • diff compares the workspace against a baseline (default <ws>/.baseline/, or --against <dir>) and
    emits a deterministic drift report: per flow, step field deltas (id-keyed), annotation moves,
    screenshot pixel diffs (changed-pixel count / % / changed-region bbox; dimension changes flagged
    distinctly), prose line-change counts, and locator changes. --format md is PR-comment-ready.
    --fail-on warn|fail exits 1 when the report severity is at/above the threshold (screenshot
    severity: ≥1% changed pixels = warn, ≥5% = fail; structural changes = warn).
  • export playwright emits one self-contained Playwright .spec.ts per flow (extends resolved) into
    <ws>/.export/tests/ (or --out <dir>) — locators as consts, steps as page actions, success criteria
    as expect() assertions, environment as test.use(); optional steps are try/catch-wrapped. Generated
    files say so in a header: regenerate, don't hand-edit.
  • render builds the static viewer by spawning the docsxai-viewer bin, resolved in order: the
    DOCSX_VIEWER_BIN env var (path to the viewer's bin script), the @docsxai/viewer
    package installed next to the engine, then \`docsxai-viewer\` on PATH.
  • login validates a bearer token against a backend URL — hits /v1/health, /v1/workspaces. Reads
    the token from DOCSX_TOKEN env var. Prints what the backend sees if the call succeeds,
    or a clear error if not. Stateless: doesn't store anything; configure the env var in your shell.
  • push serialises the workspace's doc pack (flows + annotations + screenshots + style + locators)
    and POSTs it as a new revision against the backend named in .docsxai.json (backend_url +
    optionally backend_workspace_id / backend_project_id; created on first push if absent and
    persisted to the config). --kind defaults to "calibrate"; --author defaults to the OS user.
  • pull fetches a revision's artifacts back into the workspace files (default: HEAD). Useful for
    syncing with a different operator's edits or rolling back to a named revision.`;
