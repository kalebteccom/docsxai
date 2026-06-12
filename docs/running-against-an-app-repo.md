# Running docsxai against an app repo — without leaving a trace

> The step-by-step that's kept current (incl. field notes from real test drives — `auth_cookie` pinning,
> copying gitignored `.env`/dev-cert into the worktree, dev-server port collisions, the `pnpm link` gotcha,
> loose-prose/test-guides needing hand-authoring) lives in **[`agent-runbook.md`](./agent-runbook.md)**. This file is the
> conceptual overview; where the two differ, the agent runbook wins. The one-command setup is `docsxai init`.

docsxai documents a **running web app**, not a source tree. If the app you want to document is built and
served from a local repo (e.g. a the target app / `example-app` checkout), the rule is: **docsxai operates _on_ that
app from outside — it never writes into the app repo, and you never install it _into_ the app repo.** Everything
docsxai produces (flow-files, screenshots, annotations, the captured session, the viewer) lives in a separate
**workspace directory**. For an airtight "zero traces" guarantee, run the app itself from a **disposable git
worktree** of its repo, so even build-script mutations land on a copy you throw away.

Set this once for the rest of the runbook:

```bash
export APP_REPO=/path/to/the/app/checkout          # e.g. your local example-app
export TOOL_REPO=/path/to/automated-site-documentation-bot
export WORKSPACE=$HOME/docsxai/$(basename "$APP_REPO")   # docsxai artifacts go HERE, never in $APP_REPO
export APP_RUN=/tmp/docsxai-app-run                       # disposable copy of $APP_REPO to actually run
```

---

## 1. One-time: build the tool

```bash
cd "$TOOL_REPO"
corepack enable
pnpm install
pnpm -C packages/engine exec playwright-core install chromium   # needed for run / capture-auth
pnpm -r build                                                    # compiles the CLIs to dist/
pnpm -r typecheck && pnpm -r test                                # sanity
```

Make the CLIs callable. Either link them globally —

```bash
pnpm -C "$TOOL_REPO/packages/engine"  link --global   # → `docsxai`
pnpm -C "$TOOL_REPO/packages/viewer"  link --global   # → `docsxai-viewer`  (docsxai render shells out to it)
pnpm -C "$TOOL_REPO/packages/backend" link --global   # → `docsxai-backend` (optional; the in-memory stub)
```

— or skip linking and call them directly: `node "$TOOL_REPO/packages/engine/dist/cli.js" …`. (Below assumes
they're on `PATH`.)

The Claude Code **plugin** (`$TOOL_REPO/packages/plugin`) is the first-class surface for the _calibration_
skills — `claude plugin install` it if you want `/docsxai:calibrate` etc. (The exact install incantation for
a plugin living in a monorepo subdirectory still needs validating against current Claude Code plugin docs — see
`docs/archive/phase-plans/PHASE-0.md`; until then, the calibration playbook in `packages/plugin/skills/calibrate/SKILL.md` is the script.)

> **Heads-up on calibration:** the _deterministic_ side (`run`, `render`, `capture-auth`) is real and usable
> today. The calibration _pipeline stages_ (the discovery → mapping → commit code that produces a doc pack from
> a written flow description) aren't built yet — only the contract + the playbook. So "calibrate" right now means
> _drive the playbook manually_ (Claude Code + the Claude-in-Chrome MCP + the engine primitives), not one command.

---

## 2. Per run

### 2a. Make a disposable copy of the app, and run it from there

So nothing — not even a build script that rewrites `index.html`, bumps a version, etc. — touches `$APP_REPO`:

```bash
git -C "$APP_REPO" worktree add "$APP_RUN"        # a throwaway worktree on the current commit
cd "$APP_RUN"
npm ci                                            # or `pnpm install` / `yarn` — match the app's lockfile; uses $APP_RUN/node_modules only
npm run dev                                        # start the dev server; note the URL it prints
export APP_URL="https://localhost:5173"            # ← set to whatever the dev server actually serves (HTTPS if the repo ships a dev cert)
```

(Alternatively `git clone --no-hardlinks "$APP_REPO" "$APP_RUN"` if you'd rather a full clone than a worktree.)

### 2b. Create the docsxai workspace (outside everything)

```bash
mkdir -p "$WORKSPACE"/{flows,docs,auth}
cd "$WORKSPACE"
printf '.auth/\n.viewer/\n' > .gitignore          # optional; the captured session + viewer are never committed
```

`$WORKSPACE` will hold: `flows/<flow>.flow.yaml`, `docs/<flow>/{annotations.json,screenshots/,<step>.md}`,
`docs/{style.yaml,locators.yaml}`, `auth/strategy.yaml`, and (gitignored) `.auth/<role>.json`, `.viewer/`.
**None of this goes in `$APP_REPO`.**

### 2c. Capture an authed session (manual-capture)

If the app needs login (the target app does — Azure AD SSO, ~1 h session cookie), write the auth descriptor:

```bash
cat > "$WORKSPACE/auth/strategy.yaml" <<'YAML'
schema: docsxai/auth-strategy@1
default_role: editor
roles:
  editor:
    strategy: manual-capture
    options: { capture_trigger: console }       # or `button` for an injected on-page button
    cache: { enabled: true, store: local, ttl: 1h }
YAML
```

Then capture — an instrumented Chrome opens; **you** log in interactively (SSO, MFA, conditional access — anything
you can click through); when you're in, run `window.__docsxai.capture()` in the devtools console (or click the
injected button):

```bash
docsxai capture-auth "$WORKSPACE" --base-url "$APP_URL" --ignore-https-errors
# → caches $WORKSPACE/.auth/editor.json  (expires ~1 h later — re-run when it lapses)
```

`--ignore-https-errors` accepts the app's self-signed local dev cert. Drop it if the dev server uses a trusted cert.

### 2d. Calibrate — produce the doc pack

Drive the calibration playbook (`packages/plugin/skills/calibrate/SKILL.md`): with the dev server running and you
authed in the Claude-in-Chrome session, walk each flow on the live app, settle one canonical locator per step,
add `wait_for`/`success` criteria, write `$WORKSPACE/flows/<flow>.flow.yaml`, and capture screenshots +
`annotations.json` + the style artifact + `locators.yaml` — all into `$WORKSPACE`. (When the calibration stages
are built this becomes `/docsxai:calibrate <flow.md> --url "$APP_URL" --into "$WORKSPACE"`.)

### 2e. Re-run deterministically (refresh the docs)

```bash
docsxai run "$WORKSPACE" --base-url "$APP_URL" --ignore-https-errors
# headless Chromium, uses $WORKSPACE/.auth/editor.json, replays $WORKSPACE/flows/*.flow.yaml,
# re-emits $WORKSPACE/docs/<flow>/annotations.json + screenshots. Halts on drift — see /docsxai:diagnose.
```

### 2f. View

```bash
docsxai render "$WORKSPACE"          # → $WORKSPACE/.viewer/index.html
open "$WORKSPACE/.viewer/index.html"
```

### 2g. Tear down — and confirm no trace

```bash
# stop the dev server (Ctrl-C in 2a)
git -C "$APP_REPO" worktree remove --force "$APP_RUN"   # remove the disposable copy
git -C "$APP_REPO" status                                # should be clean — you never touched it
```

---

## Why this leaves no trace in `$APP_REPO`

| Potential trace                                                                                | Avoided because                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doc pack / flow-files / annotations / screenshots written into the repo                        | They're written to `$WORKSPACE`, which is outside `$APP_REPO`.                                                                                                            |
| `npm install` / build scripts (`set-version.js`, `set-homepage.js`, …) rewriting tracked files | The app runs from the disposable worktree `$APP_RUN`; mutations land there and are removed. `$APP_REPO`'s `node_modules` / lockfile are never touched.                    |
| Captured login cookie sitting in the repo                                                      | It's in `$WORKSPACE/.auth/editor.json` (gitignored there), never in `$APP_REPO`. The docsxai backend never holds it either (`store: local`).                              |
| A vendored skill landing in `$APP_REPO/.claude/skills/`                                        | Don't `vendorSkill` into the app repo — use the globally-installed plugin (or the CLI directly). The vendored fallback is only for repos that _want_ to pin the behavior. |
| Browser profile / extension state in the repo                                                  | The browser session lives in your Chrome / Playwright's profile, not in any repo.                                                                                         |

---

## Caveats / known gaps

- **Agent-driven calibration isn't built** — `docsxai calibrate --from` handles _structured_ flow-guides (a flow-file in YAML, or a `.md` with a ```yaml block). Loose prose / the first-consumer testing guide / live element-picking = hand-author the flow-files following `packages/plugin/skills/calibrate/SKILL.md`. The deterministic `init`/`calibrate`(structured) / `run`/`render`/`capture-auth` are real.
- **Plugin install from a monorepo subdir** isn't validated yet (`docs/archive/phase-plans/PHASE-0.md` "plugin packaging prototype"). If `claude plugin install` doesn't pick up `packages/plugin/`, copy that dir somewhere installable, or just use the playbook + CLIs.
- **`--persist tmp`** is implemented for `init` (an ephemeral workspace in a temp dir); `rm -rf` it when done.
- **HTTPS dev certs:** pass `--ignore-https-errors` (or bake it into `.docsxai.json` via `init`). The `manual-capture` browser also runs security-lowered so the injected capture helper works across SSO-redirect origins. The app may also need gitignored files (`.env`, a dev-cert dir) copied into the worktree to boot.
- **Session expiry:** `manual-capture` sessions last ≈ the app's auth-cookie lifetime. Pin `cache.auth_cookie` (`capture-auth` prints the jar; or `init --auth-cookie` / `--auth-cookie`) so the cache tracks the real cookie, not a `ttl` guess. `run` fails fast with "session expired" → re-run `capture-auth` (re-login). A callable login / test-only login endpoint on the app would make it unattended; if there isn't one, expect periodic re-capture.
