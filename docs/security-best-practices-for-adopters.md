# Best practices for adopters

Operational practices we recommend for teams integrating docsxai.

## Install

- `npm install @docsxai/engine --ignore-scripts` (or the equivalent for the package you need — backend, viewer, plugin, skill). docsxai has no install-time scripts; the flag enforces it as defense in depth.
- Pin exact versions in `package.json` for high-assurance deployments (`"@docsxai/engine": "1.2.3"`, not `^1.2.3`).
- Commit your lockfile. Use `npm ci` or `pnpm install --frozen-lockfile` in CI; never loose `install`.

## Verify

- After install: `npm audit signatures` verifies the registry signatures of the installed tarballs. Releases are published from CI through npm staged publishing and carry no Sigstore provenance attestation (`0.2.0` was published by hand, also without one), so `npm audit signatures` reports no attestations for docsxai packages. Check that the installed version matches a tagged release of `kalebteccom/docsxai`.
- Watch GitHub Security Advisories on `kalebteccom/docsxai` (subscribe via the repo's "Watch → Security advisories" setting).
- Watch for unexpected version jumps in `npm outdated` output — a published version that wasn't preceded by a tagged release on GitHub is a red flag.

## Plugin install model

The `@docsxai/plugin` package is a Claude Code plugin: it lands in `.claude/plugins/` and registers calibration skills + deterministic commands. The plugin runs with the same privileges as your Claude Code session.

- Prefer `@docsxai/*` first-party packages.
- For third-party packages that extend docsxai (writeups, custom flow-file libraries), treat them like dependency reviews — read the source before installing.
- Vendor / version-pin via `@docsxai/skill` if you want a colocated fallback that lives inside your repo's `.claude/skills/` instead of being installed globally.

## Engine posture

The engine drives a Playwright instance against your running app. It writes only to its workspace dir; it does not modify the target app's repo. Two posture knobs to know:

- **The workspace directory** (the `<workspace-dir>` argument every command takes) — every artifact docsxai produces lives here. Treat this as untrusted output (it can contain rendered screenshots of your app's UI, which may include captured PII if your test data isn't clean).
- **Headed vs headless** — `capture-auth` opens a headed Chrome so a human can log in; `run` is headless unless you pass `--headed` (or `--pause`). The engine does not exfiltrate anything off-host either way.

## Building a Starlight site from a doc pack

`docsxai-viewer site` (and the `starlight:site` renderer) turns a doc pack into an Astro project, and `astro build` runs that project's MDX as code on the machine that builds it. A doc pack from a pull request is input from its author, so the emitter keeps it as data: step prose has its MDX `import`/`export` lines, `{expressions}` and JSX made plain text, step ids and flow names reach the page only as quoted strings, unsafe ids are skipped, and `visual.logo` in `docs/style.json` must name a file inside the workspace. Raw HTML in a `<step>.md` shows as text on the site. Build sites from untrusted packs in a job without secrets all the same.

## CI hygiene for adopter pipelines

If you integrate docsxai into your own CI:

- Pin every GitHub Action by full SHA, not by tag (`uses: actions/checkout@b4ffde65...` not `uses: actions/checkout@v4`).
- Use `permissions: {}` at workflow level; elevate per-job only with the minimum scope needed.
- Avoid third-party GitHub Apps that require org-wide write access.
- Use `npm ci --ignore-scripts` in CI as a baseline.
- If your CI runs docsxai against a staging app, give it scoped credentials only — never production secrets.
