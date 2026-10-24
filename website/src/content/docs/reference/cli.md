---
title: CLI
description: The full docsxai command reference - every command, every flag, and the operational notes that ship in the CLI's own help text, rendered per command.
---

This page follows the usage text `docsxai --help` prints; flag spellings are
exact, and a test checks that every command and flag shown here appears in that
text. The binary is `docsxai` - the packages are named `@docsxai/*`, the
command is not.

## Synopsis

```text wrap preserveIndent=false hangingIndent=4
docsxai init <workspace-dir> [--app-url <url>] [--auth manual-capture|none] [--role <role>] [--ttl <dur>]
                               [--capture-trigger console|button] [--auth-cookie <name>] [--ignore-https-errors]
                               [--persist tmp] [--force]
docsxai calibrate <workspace-dir> --from <flow.md|.yaml> [--name <flow>]
docsxai inspect <workspace-dir> [--url <url>] [--selector <css>] [--cdp <endpoint>] [--wait <ms>] [--wait-for <css>] [--headed] [--ignore-https-errors] [--role <role>]
docsxai run <workspace-dir> [--flow <name>] [--base-url <url>] [--headed] [--ignore-https-errors] [--stop-after <step-id>] [--start-from <step-id>] [--variant <id>] [--cdp <endpoint>] [--pause] [--concurrency <N>] [--device-scale-factor <1-4>]
docsxai run <workspace-dir> --verify-determinism [--runs <2-5>] [--format text|md|json] [--flow <name>] [--base-url <url>] [--concurrency <N>]
docsxai lint <workspace-dir> [--flow <name>] [--format text|json]
docsxai flow-tree <workspace-dir> [--format text|json]
docsxai diagnose <workspace-dir> --flow <name> --step <step-id> [--variant <id>] [--cdp <endpoint>] [--format text|json]
docsxai doctor [<workspace-dir>] [--offline] [--format text|json]
docsxai style <workspace-dir> [--check] [--format text|json]
docsxai zip <workspace-dir> [--out <output.zip>] [--include-viewer]
docsxai baseline <workspace-dir> [--out <dir>]
docsxai diff <workspace-dir> [--against <dir>] [--format text|md|json] [--fail-on warn|fail]
docsxai export adf <workspace-dir> [--flow <name>] [--mode single|page-tree] [--title <text>] [--out <dir>]
docsxai export playwright <workspace-dir> [--flow <name>] [--out <dir>]
docsxai plugins <list|info|sync> <workspace-dir> [<namespace>] [--format text|json]
docsxai login --backend-url <url> [--oauth <workspace-dir>]
docsxai push <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
docsxai pull <workspace-dir> [--rev <id>]
docsxai render <workspace-dir>
docsxai burn <workspace-dir> [--flow <name>] [--out <dir>] [--report <file>] [--no-connector-outline] [--strict-glyphs]
docsxai pack <workspace-or-raw-dir> [--from-raw] [--out <dir>] [--public-prefix <path>] [--no-optimise] [--generated-for <text>]
docsxai pack <workspace-or-raw-dir> --check --against <pack-dir> [--from-raw] [--threshold <pct>]
docsxai capture-auth <workspace-dir> [--base-url <url>] [--role <role>] [--auth-cookie <name>] [--cdp <endpoint>] [--fresh] [--headless] [--ignore-https-errors]
docsxai --help
docsxai --version
```

A _workspace_ (created by `init`) holds `flows/<flow>.flow.yaml`, `docs/`,
`auth/strategy.yaml`, `.auth/`, `.viewer/`, and a `.docsxai.json` config.
Put it OUTSIDE the app's source repo - docsxai documents a running app from
outside and never writes into the app repo. `run` and `capture-auth` read
`app_url` and `ignore_https_errors` from `.docsxai.json` if you do not pass
the flags. `run` also reads `"annotations": { "obstacles": true }` (default
off): it then records the text and controls around each annotated element so
burned screenshots keep callouts off them. `--ignore-https-errors` accepts self-signed or invalid TLS
(an app's local HTTPS dev cert, say).

Every command exits 0 on success. Validation problems (a missing argument, a
bad flag value) exit 2; operational failures (a halt, a lint warning, drift at
the threshold) exit 1. A flag a command does not take exits 2 (`burn` and
`pack` too), and most commands name the nearest flag when one is close:
`run --flwo x` prints `unknown flag --flwo, did you mean --flow?`. Giving a
flag twice exits 2 as well, except `burn --flow`, which repeats. A flag that
takes no value never reads the next argument, so `run --pause <workspace-dir>`
keeps the workspace, and `--pause=yes` exits 2. A value flag with no value exits
2 with `<flag> needs a value`. `doctor` follows the same rules: an unknown flag,
`--offline` twice and `--offline=yes` all exit 2. Ctrl-C (SIGINT) or SIGTERM
stops a command with one `docsxai: interrupted` line and a `next:` line, and
exits 130 (SIGINT) or 143 (SIGTERM). While `render`, `burn` or `pack` runs, the
signal goes to the viewer child and docsxai waits for it: the child gets SIGKILL
after 10 seconds, and a second signal exits at once. The transcripts below show
representative output; paths and counts vary with your workspace.

Reports and data go to stdout. Progress lines and warnings go to stderr where
a command already splits them, and nothing is coloured. A failing command
prints `<command>: what failed` and, when a command can fix it, a second line
`  next: <command to run>`. A usage error also prints that command's own usage
line; `docsxai --help` lists every flag.
Running `docsxai` with no argument prints three first steps (`init`, `calibrate`,
`run`) and the commands by purpose. `help <command>` and `<command> --help` print
only that command's usage and one example, and exit 0. A mistyped command exits 2
and names the closest command when one is within two edits. `run`, `calibrate`, `burn`, `pack`,
`zip`, `baseline`, `push`, `pull` and `doctor` end with one line that starts
with the command name and gives the counts and where the output went. Use
`--format json` where a command offers it when a script reads the output: the
text formats are for people.

`docsxai --version` (or `-v`) prints the installed version and exits 0. `docsxai-viewer --version` does the same for the viewer.

An error that no command turned into a message is a bug in docsxai. The CLI
prints `docsxai: unexpected error: <first line>` and a `next:` line, and exits 1.
Set `DOCSX_DEBUG=1` and run the command again to print the stack trace, then
include it when you report the bug.

## The core loop

### `docsxai init`

Scaffolds the workspace: `flows/`, `docs/`, `auth/`, `.auth/`, `.viewer/`, a
`.gitignore`, a `README.md`, `auth/strategy.yaml`, a sample flow-file
(`flows/example.flow.yaml.sample`, ignored until you calibrate it), and
`.docsxai.json` (holding `app_url` plus `ignore_https_errors` so later commands
need no flags). `--auth` must be `manual-capture` (the default) or `none`, which
writes no `auth/strategy.yaml` and suits an app that needs no login; `--ttl <dur>` sets the
session-cache fallback expiry (`30m`, `1h`); `--capture-trigger` picks
between the devtools-console capture call and an injected on-page button;
`--auth-cookie <name>` pins the cache expiry to a named cookie up front. For
a fully ephemeral workspace use `--persist tmp` (it prints the temp dir);
`--force` re-inits over an existing directory. `--app-url` has to be an `http://` or
`https://` URL, or `init` exits 2 with its usage line. A path that is a file stops with
`<path> is a file, not a directory`, and a `mkdir` the filesystem refuses points
`chmod` at the existing parent directory.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai init ~/docsxai/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h
init: workspace at ~/docsxai/my-app
  created: flows/, docs/, auth/, .auth/, .viewer/, .gitignore, .docsxai.json, auth/strategy.yaml, flows/example.flow.yaml.sample, README.md
  next: docsxai capture-auth ~/docsxai/my-app  →  docsxai calibrate ~/docsxai/my-app --from <flow.yaml>  →  docsxai run ~/docsxai/my-app  →  docsxai render ~/docsxai/my-app
```

### `docsxai capture-auth`

Runs the role's auth strategy (for `manual-capture`: a headed, instrumented
browser you log into; `window.__docsxai.capture()` or an injected
button snapshots the session) and caches it to
`<workspace-dir>/.auth/<role>.json` for subsequent runs, with file mode 0600
(owner read and write). A role name with characters outside `A-Za-z0-9_.-`, and
the role name `backend-token`, gets a hash suffix in its file name, so `a/b` and
`a_b` never share a session and no role overwrites the OAuth token file. A cache
that predates the suffix is captured once more. It prints the captured cookie jar
so you can identify the app's real auth/session cookie.

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

```text wrap preserveIndent=false hangingIndent=4
$ docsxai capture-auth ~/docsxai/my-app --auth-cookie session
capture-auth: launching browser for role "editor" (manual-capture), reusing saved profile if present; log in if prompted, then trigger capture…
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

```text wrap preserveIndent=false hangingIndent=4
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
cached session to load. `--ignore-https-errors` accepts a self-signed or invalid
TLS certificate (the same setting is read from `ignore_https_errors` in
`.docsxai.json`).

```text wrap preserveIndent=false hangingIndent=4
$ docsxai inspect ~/docsxai/my-app
inspect: https://localhost:3000/dashboard
  title: Acme · Dashboard
  4 [data-testid] element(s) (✓ = visible), pin these as locators:
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
`--base-url <url>` overrides the workspace's `app_url`; it has to be an `http://`, `https://` or
`file://` URL, or `run` exits 2 with its usage line. An `app_url` in `.docsxai.json`
that is not one stops with exit 1 and names the file.

Start-up failures print one reason and one `next:` line. A missing Chromium gives the
install command, a `--cdp` endpoint nobody listens on gives
`cannot attach to the browser at <endpoint> (ECONNREFUSED)` and the
`--remote-debugging-port` flag to start Chrome with, and `run --cdp` does not ask for a
cached session first. `run`, `lint` and `flow-tree` on a workspace whose `flows/` was
deleted print `mkdir <dir>/flows`; on a non-empty directory with no `.docsxai.json` they
say it is not a workspace. A cached session that is not valid JSON is reported as
corrupt, not expired; re-run `capture-auth`. A `.docsxai.json` that exists but cannot be
read (`EACCES`) prints a `was ignored (it cannot be read, EACCES)` warning with a
`next:` line, also in `capture-auth`. On Node 18 and older the CLI prints
`docsxai: Node v18.20.5 is too old to start (the engine requires Node >= 26)` and exits 1
before Playwright's own text.

- `--stop-after <step-id>` runs only a prefix of the flow (up to and
  including that step); `--pause` keeps the (headed) browser open at the last
  step run, so you can inspect the live state mid-flow when calibrating
  (pair with `--flow <name>`). For a slow backend op, give a step a
  `wait_for` of the form `{ selector: $x, timeout_ms: 180000 }` - a per-step
  override of the default ~30s selector-wait timeout.
  A step id that no selected flow has exits 2 before the browser launches,
  and so does an unknown `--start-from` id.
- `--start-from <step-id> --flow <name>` SKIPS every step before
  `<step-id>` and starts execution there - the inverse of `--stop-after`.
  Pair with `--cdp` to attach to a Chrome already in the post-prior-steps
  state (left over from a paused previous run, say) and iterate on a new
  tail step in seconds rather than re-walking the whole `extends` chain. New
  annotations MERGE into the existing `annotations.json` by step id; prior
  steps' annotations and screenshots are preserved.
- `--variant <id>` runs one variant of a flow with a [matrix](/reference/flow-file/#matrix),
  for example `es-ES.dark.mobile`. Every variant gets its own browser session and
  writes to `docs/<flow>/<variant>/`; without `--variant` they all run.
  `--cdp` cannot run a matrix flow.
- `--cdp <endpoint>` attaches to a running Chrome (start it with
  `--remote-debugging-port=N`) instead of launching one; docsxai will not
  close that Chrome. When `--cdp` is set, the cached storageState is NOT
  loaded into the context - the attached Chrome keeps its own auth state.
- `--concurrency <N>` runs up to N flows in parallel, each in its own
  isolated Chromium session (default 1). Useful when several flows share a
  long preamble: total wall time is the longest flow, not the sum.
  Force-clamped to 1 when `--pause`, `--stop-after`, `--start-from`, or
  `--cdp` is set. The target app must tolerate multiple sessions from one
  user.
- `--device-scale-factor <1-4>` captures at that many device pixels per CSS
  pixel: a whole number or one decimal, default 1. At 2, a 1280 by 800
  viewport gives a 2560 by 1600 PNG. A value outside 1 to 4 exits 2.
  `DOCSX_DEVICE_SCALE_FACTOR` sets it when the flag is absent, and the flag
  wins. It cannot be combined with `--cdp`, since the attached browser owns
  its scale. Above 1, `annotations.json` carries `device_scale_factor`;
  `bounding_box` and `obstacles` are in the PNG's own pixels, so nothing
  needs converting, and `docsxai burn` reads the factor from the file.
  Without the flag the output is unchanged.

- `--verify-determinism` runs the selected flows more than once and compares
  the bytes; see [Verifying determinism](#verifying-determinism) below.

A clean run prints one line per flow and exits 0:

```text wrap preserveIndent=false hangingIndent=4
$ docsxai run ~/docsxai/my-app --flow publish-post
run: publish-post, 5 step(s) executed, 4 annotation(s) written
run: 1 of 1 flow ok, outputs in ~/docsxai/my-app/docs
```

A halted run names the step, the inferred cause, and the halt screenshot,
then exits 1 - hand that to [`diagnose`](#docsxai-diagnose) rather than
retrying:

```text wrap preserveIndent=false hangingIndent=4
$ docsxai run ~/docsxai/my-app --flow publish-post
run: [target is covered by another element] step "publish" (click) failed at
https://localhost:3000/editor/draft-7: … (halt screenshot: docs/publish-post/halts/publish.png)
run: 1 of 1 flow failed, 0 ok; outputs in ~/docsxai/my-app/docs
  publish-post: next: docsxai diagnose ~/docsxai/my-app --flow publish-post --step publish
```

:::caution[For agents]
A halt replays identically on a retry - the engine has no retry-until-green.
The productive loop is `diagnose` → edit the flow-file →
`run --start-from <step-id> --cdp <endpoint>` to validate the fix in seconds
instead of re-walking the flow. See the
[agent guidance](/guides/agent-guidance/#diagnose-after-a-halt-never-blind-retries).
:::

#### Verifying determinism

`docsxai run <workspace-dir> --verify-determinism` checks that the same flows
against the same target produce the same doc pack. It runs the selected flows
`--runs <N>` times (2 to 5, default 2), each into its own root under
`<workspace>/.docsxai-verify/run-<k>/`, then compares every file byte by byte:
`annotations.json`, the screenshots, step markdown, locators and halt context.

- The workspace output is written only when every run agrees. Run 1's files
  are then copied in, the same bytes a plain `run` writes. When the runs
  differ, or a flow halts, the workspace is left as it was.
- The run roots are removed when the command ends, file by file from the
  listing of each root; nothing outside them is touched.
- The report goes to stdout, progress to stderr. `--format text|md|json`
  picks the rendering (default `text`). The report has no timestamps and no
  paths, so the same runs print the same bytes.
- It names the first differing artefact by path, then every other one, each
  with a cause: the JSON key path (`annotations[0].bounding_box.x`), the
  changed-pixel count and bounding box of a PNG, the first differing line of
  a text file, or the sizes.
- Exit 0: identical. Exit 1: differing, or a flow halted. Exit 2: bad flags,
  including `--runs` outside 2 to 5 and any combination with `--pause`,
  `--stop-after`, `--start-from` or `--cdp`.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai run ~/docsxai/my-app --verify-determinism
verify-determinism: 2 runs of 1 flow (publish-post), 5 artefacts per run
result: DIFFERING
first differing artefact: docs/publish-post/screenshots/publish.png (run 2 vs run 1)
  cause: 31 pixels differ (0.0034%) inside x=412 y=88 52x12
The workspace output was not touched
```

The [determinism and drift guide](/guides/determinism-and-drift/) covers
fixing a differing artefact and the nightly CI recipes.

### `docsxai render`

Builds the static viewer by spawning the `docsxai-viewer` bin, resolved in
order: the `DOCSX_VIEWER_BIN` env var (path to the viewer's bin script),
the `@docsxai/viewer` package installed next to the engine, then
`docsxai-viewer` on PATH. A launch failure reports all three attempts.

`render` reads the same `burn.theme` block, so the live callouts match the burned ones (see
[Themeable burned captions](/guides/burn-theming/)).

Flow names and step ids from the doc pack become file paths and link targets, so
`render` skips a flow name or step id that holds `..`, `:`, `\` or a control
character (a step id also `/`), with a warning on stderr. A `docs/` folder that
does not exist, or a `--flow` name with no folder under `docs/`, also prints a
warning; the viewer still writes its (empty) page. Each flow renders once, and
`#`, `?` and `%` in names are percent-encoded in the page's links and images. A step
with a screenshot and no record in `annotations.json` stays on its page as a plain
screenshot after the annotated steps, and numbered ids sort by value (`step-2` before
`step-10`). An `annotations.json` that is not valid JSON prints a warning and the page
lists the screenshots without callouts; one that cannot be read (permissions, a
directory in its place) stops `render` with an error that names the file. A page with a
missing screenshot offers the command that captures it again; a flow name or step id
with a space, quote or `$` is single-quoted in it, so it pastes as one word. `render`
takes no flags; `docsxai-viewer build --flow <name>` also renders the variant folders of
a matrix flow, and `docsxai-viewer build --lang fr` warns that only `en` and `es` have
text tables and writes English.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai render ~/docsxai/my-app
render: open ~/docsxai/my-app/.viewer/index.html  (the index links the flows; each flow page
shows the screenshots, hover a pulsing halo to read its callout)
```

### `docsxai burn`

Bakes each annotation (halo, numbered badge, callout) into a copy of its clean
screenshot, for surfaces that cannot run the interactive viewer. It runs the
viewer's `burn` through the same bin resolution as `render`. Reads
`<workspace>/docs/<flow>/annotations.json` and writes
`docs/<flow>/burned/<step>.png`, or `<out>/<flow>/<step>.png` with `--out`.
`--flow` limits it to named flows and can be repeated; the default is every
flow with an `annotations.json`. A flow that ran a [matrix](/reference/flow-file/#matrix)
holds its outputs one level down, and `burn` treats each `<flow>/<variant>` as a
flow: `--flow <name>` selects all of a flow's variants. `--report <file>` writes a
JSON placement report (`docsxai/burn-report@1`: callout and badge boxes,
overlaps, and `unplaceable` for a callout whose best spot still covers more than
10% of its own area), resolved under the workspace when relative. The report
threshold (`--max-overlap <ratio>`) is a flag of the viewer's own bin,
`docsxai-viewer burn`; `docsxai burn` does not forward it. `--no-connector-outline`
skips reading the screenshot's pixels: an arrow or stem stays plain ink (by default one over
a dark part of the screenshot gets a white outline), a themed line keeps the callout's outline
colour, and no text is estimated from the pixels. A caption with characters the font
can't draw (Japanese, Arabic, Hebrew, Thai with the bundled font) prints a warning naming
the annotation and the script, and its report entry gets `missing_glyphs`;
`--strict-glyphs` then exits 1, see [the font guide](/guides/burn-theming/#characters-the-font-cant-draw).
Exit 1 when the workspace has no `docs/` directory or no flow to burn; exit 2 for a bad flag.

An annotation whose `bounding_box` lies outside the screenshot, has zero or negative
size, or holds `NaN` or infinity is skipped with a warning that names its selector and
step, and `--report` lists it with `skipped` set. A box that only overhangs an edge is
clipped to the image. A flow whose `annotations.json` is missing, unreadable or not valid
JSON stops the burn with a message that names the file.

The look of the halo, badge, callout and connector comes from the `burn.theme` block of
`.docsxai.json`: four presets, an optional tokens file and per-key overrides. A workspace without
the block burns the original look, byte for byte. The block, `connector_style` and `caption_style`
are new in the next release; see
[Themeable burned captions](/guides/burn-theming/).

```text wrap preserveIndent=false hangingIndent=4
$ docsxai burn ~/docsxai/my-app --report burn-report.json
burn: wrote 6 image(s) to ~/docsxai/my-app/docs/publish-post/burned
burn: wrote report to ~/docsxai/my-app/burn-report.json (0 unplaceable)
```

### `docsxai pack`

Builds the screenshot pack a docs site or README ships: every step's annotations
burned into its clean screenshot, the PNG optimised losslessly, named from its
final bytes, and a `manifest.json` that lists them. It runs the viewer's `pack`
through the same bin resolution as `render`.

`<dir>` is a workspace (it has `docs/`) or a raw capture directory. A workspace
needs a `pack.json` (`docsxai/pack-config@1`) that says which capture flow feeds
which variant and holds the alt text:

```json
{
  "schema": "docsxai/pack-config@1",
  "sources": {
    "desktop-1280": { "flow": "app", "variant": "en.dark.1280" },
    "mobile-390": { "flow": "app", "variant": "en.dark.390" }
  },
  "flows": {
    "app": {
      "title": { "en": "Acme" },
      "steps": { "board": { "alt": { "en": "Board with a card per task." } } }
    }
  }
}
```

A raw capture directory holds `<flow>/<step>/<locale>.<theme>.<viewport>.png`
with a `.json` sidecar (`width`, `height`, `annotations` as `{ index, copy, bbox }`
plus optional `arrow_style`, `nudge`, `obstacles`, `placement`), a `step.json`
(`alt`, optional `caption`) and an optional `flow.json` (`title`). `--from-raw`
reads `<dir>` that way even when it has a `docs/` folder.

A flow with a [matrix](/reference/flow-file/#matrix) writes one directory per cell,
`docs/<flow>/<variant id>/{screenshots/, annotations.json}`, and `pack.json` reads
those in two forms. The ids (`en-US.dark.mobile-390`) and the pack keys
(`en.dark.390`) are different grammars, so each id is mapped to a key. A `sources`
entry with `matrix` names one variant directory; its key is only a label:

```json
{
  "sources": {
    "login-mobile": { "flow": "login", "matrix": "es-ES.dark.mobile-390", "variant": "es.dark.390" }
  }
}
```

`matrixFlow` takes every variant directory of one flow. `map` gives
`<matrix id>: <pack key>`, and `"auto": true` maps the ids that already read
`<locale>.<theme>.<viewport width>` to themselves (name a viewport by its width,
`{ name: "1280", ... }`, in the flow's matrix for that):

```json
{
  "matrixFlow": {
    "flow": "login",
    "auto": true,
    "map": { "en-US.light.desktop-1280": "en.light.1280" }
  }
}
```

Use one form per flow. `matrixFlow` stops on a variant directory it has no key
for, so pack a subset with `sources` entries. `packFlow` sets the flow id in the
pack when the matrix flow's name is not a valid one (capitals, dots). A
`flows.<flow>.steps` entry is written once and checked against every variant, and
`alt` needs each locale the mapped keys use. `pack --check` reads the same layouts.
A symlinked flow or `screenshots/` directory stops the pack, a symlinked variant
directory is skipped with a warning under `matrixFlow`, and a flow with more than
256 variant directories is refused. Errors name paths relative to the workspace.

Output goes to `--out` (default `<workspace>/.screens`; required for a raw
directory): `<flow>/<step>.<hash8>.png` plus `manifest.json`
(`docsxai/screens-pack@2`). Locales, themes and viewports are not a fixed list; a
variant key is `<locale>.<theme>.<viewport>`, for example `pt-BR.dark.1280`.
`--public-prefix` is the URL path the files are served under (default
`/screens`). `--generated-for` records free text such as a commit sha; without it
the key is left out, and the manifest never holds a timestamp.

Optimising uses the external `oxipng` binary: the path in `$DOCSX_OXIPNG_BIN` when
that is set, otherwise `oxipng` on PATH. When it is missing the command fails with a
one-line message (its `brew install oxipng` hint is for macOS; on Linux install a
release binary of `oxipng`); `--no-optimise` skips it. The hash is taken from the optimised bytes, and
the optimiser's output is checked first: it has to be a complete PNG with the same
pixels as its input, or the build stops. A different `oxipng` version can produce
different bytes, so upgrading it changes the hashes (pin it in CI). Files the old
`manifest.json` listed and the new one does not are removed by exact path, and
nothing else in `--out` is touched. Loopback addresses (`localhost`, `127.x.x.x`,
`::1`, `0.0.0.0`), private-network addresses (10/8, 172.16/12, 192.168/16, link-local
169.254/16), email addresses (the reserved example domains `example.com`,
`example.org`, `example.net` and the `.test`, `.invalid` and `.example` TLDs pass),
`Authorization:` headers other than `Bearer`, tokens in a URL query and obvious
secrets in a title, caption, alt text, callout or the `--generated-for` text stop the
build, naming the manifest path and rule. A damaged `annotations.json` record (a
`bounding_box` with a string for `x`, a `placement.side` that is not a side, a bad
`nudge`, `obstacles`, `arrow_style` or `index`) stops it with the file, the record's
position and the field. Exit 1 for a failed build, 2 for a bad flag.

`pack` and `pack --check` read the workspace's `burn.theme` block as well (see
[Themeable burned captions](/guides/burn-theming/)).

```text wrap preserveIndent=false hangingIndent=4
$ docsxai pack ~/docsxai/my-app
pack: 32 image(s), 3 written, 1 removed in ~/docsxai/my-app/.screens
```

### `docsxai pack --check`

Rebuilds the pack in memory (nothing is written and `oxipng` is not needed) and
compares it with the committed pack in `--against` (required). A variant whose file hash is
unchanged is skipped. Otherwise both PNGs are compared pixel by pixel and the
line shows the changed share of the image and the box around the change. A
rebuild that differs only in bytes (the optimiser) passes. The command fails for
a change over `--threshold` (percent, default 0.5), a resized variant, a new or
missing variant, and a committed file that does not match its name. Exit 1 on any
of those, 2 for a bad flag, and 1 when the committed `manifest.json` is missing or is not
`docsxai/screens-pack@2`. The report has no timestamps. The `drift` command of
earlier builds still works for now: it prints a deprecation warning and runs
`pack --check` with the same arguments.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai pack ~/docsxai/my-app --check --against web/public/screens
docsxai drift: 32 compared, 1 over threshold (0.5%)
  changed  app/board/en.dark.1280  2.4113%  region 40,96 612x188  OVER
```

## Calibration aids

### `docsxai lint`

Pure-static checks across the workspace's flow-files - no Playwright, no
live page. The core rules cover deep `extends` chains, annotations anchored
to likely-unmounting click/navigate targets, selector waits with no
`timeout_ms` on long-async-looking steps, bare `[data-*=...]` selectors
prone to hidden duplicates, and more - the full R001-R017 table is in
[Troubleshooting](/guides/troubleshooting/). Workspace plugins can add
rules. Exit 1 if any warning or error; `--format json` emits
machine-readable output for tooling. R017 warns when a flow's `name:` differs
from its file name (`flows/payment.flow.yaml` with `name: checkout`), because
`extends`, `--flow` and `docs/<name>/` all use the name; it names both, so lint
exits 1. Two flow files that share one `name:` stop `lint`, `flow-tree` and `run`
with exit 1 and name both files.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai lint ~/docsxai/my-app
flow publish-post
  R004 [info] step 'open-editor': selector `[data-testid="new-post"]` is a bare `[data-*=…]` match; it may resolve to multiple DOM nodes (visible + hidden duplicate)
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

```text wrap preserveIndent=false hangingIndent=4
$ docsxai flow-tree ~/docsxai/my-app
preamble    [3 steps]
├── publish-post    [5 steps]
└── invite-user    [4 steps]

3 flows, max chain depth 1
```

A flow with a [matrix](/reference/flow-file/#matrix) lists its variants after the
step count: `tour    [4 steps]    {4 variants: en-US.light, en-US.dark, es-ES.light, es-ES.dark}`.

### `docsxai diagnose`

Gathers halt context for a specific step: the step's selector, `wait_for`,
and `success`, the halt screenshot if one exists, and - with `--cdp` - a
live `actionable()` probe of the target on the running page. Prints typed
recommendations (`selector` / `wait_for` / `success` / `annotation_target` /
`split_step` / `investigate`). The engine never patches the flow-file itself;
that is the agent's explicit opt-in action. `--format json` emits
machine-readable output for an agent to act on. Pair with
`run --start-from <step-id> --cdp` to validate the fix in seconds. On a flow
with a [matrix](/reference/flow-file/#matrix), `--variant <id>` picks the
variant (its steps and its `halts/` screenshot). Without it, `diagnose` takes
the one variant that holds a halt screenshot for the step, and otherwise lists
the variants and exits 2.

```text wrap preserveIndent=false hangingIndent=4
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
  [wait_for] the live probe reports the target covered, another element receives the click
    → wait out (or dismiss, via a prior optional step) the covering element before this click
```

### `docsxai doctor`

Health-checks the environment and the workspace: one `ok:` or `fail:` line per
check, each with a `next:` step, in plain text that reads the same in a pipe or CI
log. The checks: Node >= 26, a Chromium binary for playwright-core (the fix is the
install command), `.docsxai.json` found and valid (the argument, or the current
directory; fields and the shape of `burn.theme`, whose values and contrast the viewer
checks when you run `docsxai burn`), write access to the workspace and its output
dirs, every flow-file parses, the auth descriptor plus the cached session's
freshness, a HEAD to `app_url` with a 3 s timeout (skipped with a clear line when
offline or with `--offline`), backend reachability and login state when `backend_url`
is configured, the plugin declarations and lock through the same inspection
`plugins list` runs - declared/installed/lock/capabilities, with **no plugin
code executed** - where the viewer was found, and environment settings. Exit 1 on any
`fail:` line, and 2 on a flag it does not know (`doctor --offine` used to probe the network).

The first line is the docsxai version. When every check passes, the last line names the
next command for the workspace: `init <workspace-dir> --example` outside a workspace,
`calibrate` with an empty `flows/`, `run` with flows and nothing captured, and
`render --open` once `docs/` holds annotations. `--format json` prints one document instead
of the lines: `schema` (`docsxai/doctor@1`), `version`, `ok`, `checks` (each with `name`,
`ok`, `info`, `detail` and `next`, which is `null` without a follow-up) and `next`. Every
key is always present.

The `workspace` and `flows` rows name why a workspace is unusable: a `.docsxai.json` it cannot read
(`chmod u+r <file>`), one that holds an array, `null`, a string or a number, invalid JSON
(the position in the file, not `init --force`, which would rewrite it), a path that does
not exist or is a file, and a deleted `flows/` (`mkdir <dir>/flows`). The `plugins` row
does not repeat a config failure the `workspace` row already printed.

The env row counts the docsxai variables you set and names none of them; the viewer path
the `docsxai` bin sets for itself isn't counted. It fails on three things. `DOCSX_CACHE_KEY`, when set, has to decode to 32
bytes. A `DOCSX_*` name that no docsxai package reads is flagged as a likely typo; the
names it knows are `DOCSX_TOKEN`, `DOCSX_CACHE_KEY`, `DOCSX_VIEWER_BIN`,
`DOCSX_ENGINE_BIN`, `DOCSX_DATA_DIR`, `DOCSX_OAUTH_AUTO_APPROVE`,
`DOCSX_WEBHOOK_SECRET`, `DOCSX_OXIPNG_BIN`, `DOCSX_BACKEND_DENY_PRIVATE_APP_URL`,
`DOCSX_EGRESS_GUARD`, `DOCSX_EGRESS_DENY_PRIVATE`, `DOCSX_MCP_TOKEN`, `DOCSX_DEBUG` and
`DOCSX_DEVICE_SCALE_FACTOR`. And the
three on/off switches (`DOCSX_BACKEND_DENY_PRIVATE_APP_URL`, `DOCSX_EGRESS_GUARD`,
`DOCSX_EGRESS_DENY_PRIVATE`) fail the row when set to something other than `1`, `true`,
`yes`, `0`, `false` or `no` (any case), because any other value reads as off.
`docsxai doctor --help` prints its usage line and what the lines mean, and runs no check.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai doctor ~/docsxai/my-app
ok: version: docsxai 0.3.0-rc.4
ok: node: v26.1.0 (>= 26 required)
ok: chromium: ~/Library/Caches/ms-playwright/chromium-1223/…/Google Chrome for Testing
ok: workspace: ~/docsxai/my-app/.docsxai.json (docsxai/workspace@1, app_url https://localhost:3000)
ok: config: .docsxai.json fields are valid
ok: writable: ~/docsxai/my-app and its output dirs are writable
ok: flows: 3 flow-file(s) parse
ok: auth: auth/strategy.yaml ok, role(s) editor (default "editor", strategy manual-capture)
fail: auth: cached session for role "editor" expired 2026-06-12T11:00:00.000Z next: re-capture: docsxai capture-auth ~/docsxai/my-app
ok: app_url: https://localhost:3000/ answered HTTP 200
ok: backend: no backend_url configured, the workspace operates fully locally
ok: login: no backend_url, so no backend login is needed
ok: plugins: no plugins configured (add a "plugins" array to .docsxai.json)
ok: viewer: found at …/@docsxai/viewer/dist/index.js
ok: env: no docsxai variables set, defaults apply
fail: doctor: 1 of 10 checks failed next: fix the fail lines above, then run docsxai doctor again
```

Run it first when anything misbehaves - it answers the usual "is it my
environment or my flow?" question in one shot, and every failing line names
its own next step.

### `docsxai style`

Initialises `docs/style.yaml` plus the derived `docs/style.json` if absent;
otherwise validates the existing YAML against the schema and rederives the
JSON. `--check` additionally scans every `docs/<flow>/<step>.md` user-facing
write-up for jargon leaks against the style's `pruning_rules` (VERIFY, WAIT,
`data-testid` leaking into user-facing prose, say). The engine never
re-shapes prose itself; the agent does that at calibration time - this
command is the enforcement layer. `--format json` for tooling. A workspace path
that is not a directory exits 1 with `<path> is not a directory` and writes nothing.

```text wrap preserveIndent=false hangingIndent=4
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

`baseline` reads only `docs/<flow>/screenshots/` and `docs/<flow>/annotations.json`. A
flow with a [matrix](/reference/flow-file/#matrix) writes one directory per variant
below those paths, so its screenshots are not in the baseline.

```text wrap preserveIndent=false hangingIndent=4
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

```text wrap preserveIndent=false hangingIndent=4
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

Because the baseline holds no matrix screenshots, `diff` reports no screenshot drift
for a matrix flow, and exits 0 even under `--fail-on warn`; it still compares the flow
YAML (steps and locators). Gate a matrix workspace's screenshots with
[`pack --check`](#docsxai-pack---check), which reads the variant directories, and keep
`run --verify-determinism` as the separate check that two runs agree.

## Packaging and export

### `docsxai zip`

Packages the workspace's doc pack into a single archive for hand-off.
Includes `flows/`, `docs/`, `.docsxai.json`, `auth/strategy.yaml` (env-var
names only, no creds), `README.md`. Excludes `.auth/` (local
session state), `**/halts/` (debug screenshots), and `.viewer/` by default
(re-renderable from the pack; pass `--include-viewer` to bundle it). Defaults
output to `<workspace-name>.zip` in the current dir; override with
`--out <path>`. Zips in-process (no system `zip` binary needed) and
deterministically - sorted entries, fixed mtime, fixed compression - so the
same doc pack always produces a byte-identical archive. A symlink that points
outside the workspace is left out, whether it is one of the fixed entries
(`README.md`, `.docsxai.json`, `auth/strategy.yaml`, `docs/`) or sits below a
directory. The archive is written atomically, and the output directory is created
only once there is something to write.

```text wrap preserveIndent=false hangingIndent=4
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

A flow file, step markdown file or screenshot that is a symlink to a file outside
the workspace is left out of `projection.json` and `attachments.json`, so a
publisher never uploads it. A symlink to a file inside the workspace still works.
`export playwright` skips them the same way.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai export adf ~/docsxai/my-app --mode page-tree
export adf: wrote ~/docsxai/my-app/.export/adf/projection.json (3 documents, mode page-tree) + ~/docsxai/my-app/.export/adf/attachments.json (9 attachments)
```

### `docsxai export playwright`

Emits one self-contained Playwright `.spec.ts` per flow (`extends` resolved)
into `<ws>/.export/tests/` (or `--out <dir>`): locators as consts, steps as
page actions, success criteria as `expect()` assertions, `environment` as
`test.use()`; optional steps are try/catch-wrapped. Generated files say so in
a header: regenerate, do not hand-edit.

```text wrap preserveIndent=false hangingIndent=4
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

```text wrap preserveIndent=false hangingIndent=4
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
nothing. With `--oauth <workspace-dir>` (the sign-in for a person, as opposed
to the CI token) it instead drives the full OAuth 2.1
authorization-code + PKCE handshake against the backend and stores the tokens
at `<workspace>/.auth/backend-token.json` (mode 0600); `push`, `pull`, and
`run` pick them up from there.

```text wrap preserveIndent=false hangingIndent=4
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
defaults to the OS user. Screenshots and `annotations.json` under
`docs/<flow>/<variant>/` (a matrix flow) travel too. The revision is finalized after
upload - a sealed, immutable snapshot. The backend URL printed in the summary has no
query string or fragment.

`push` reads the whole doc pack before it calls the backend. A pack it cannot read
(an invalid `docs/style.json`, say) exits 1 naming the file, and nothing is created
on the backend. A flow file, annotations file, screenshot, `style.yaml`, `style.json`
or `locators.yaml` that is a symlink to a file outside the workspace is left out of
the pack. The ids `push` records in `.docsxai.json` are written atomically.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai push ~/docsxai/my-app --kind run --author ci
push: screenshots, 2 blob(s) uploaded, 7 already on the backend
push: revision 1d4f0c9a-6f4e-4b9a-9a3e-7f1d2b8c5e10 (run, ci) on http://127.0.0.1:4477, 5 artifact slots uploaded, finalized
```

### `docsxai pull`

Fetches a revision's artifacts back into the workspace files (default:
`head`; `--rev <id>` for a named revision). Useful for syncing with
someone else's edits or rolling back. Fetched screenshot blobs are
verified against their sha256 before they touch disk. `pull` asks the backend only
for the artifact names `flows`, `annotations`, `screenshots`, `style` and `locators`
and prints a warning for any other name in the revision.

The doc pack is written as one transaction. `pull` stages every file next to its
target first and then renames them all into place; a failure while staging changes
nothing, and a failed rename puts the files already swapped back. A workspace never
holds half of the new revision and half of the old.

```text wrap preserveIndent=false hangingIndent=4
$ docsxai pull ~/docsxai/my-app
pull: revision 1d4f0c9a-6f4e-4b9a-9a3e-7f1d2b8c5e10 (run, ci), wrote 23 file(s) to ~/docsxai/my-app
```

The backend is not trusted with file names. Before it writes anything, `pull`
checks every name in the revision and refuses the whole revision on one bad name:

- a flow file must be `<flow name>.flow.yaml`, where the name follows the
  [flow name rule](/reference/flow-file/#top-level-keys) (letters, digits, `.`, `_`
  and `-`, no `..`, no trailing `.`, not a Windows device name, at most 64
  characters);
- annotations must be `docs/<flow>[/<variant>]/annotations.json` and screenshots
  `docs/<flow>[/<variant>]/screenshots/<file>.png`, `.jpg`, `.jpeg` or `.webp`, with
  the same character rules for the variant and the file stem, no variant named
  `annotations.json` or `screenshots`, and at most 128 characters in a variant or file name;
- two names that differ only by case (`Tour/` and `tour/`) are refused, because
  they are one directory on a case-insensitive disk.

A refused revision exits 1 with `refusing the pulled doc pack, nothing written`, and
the `next:` line suggests an older `--rev`. Flow, annotation and screenshot files are
also written through the workspace root, so a symlink inside the workspace that
points out of it stops the pull.

The endpoint surface behind `login`/`push`/`pull` is documented in the
[backend API reference](/reference/backend-api/).
