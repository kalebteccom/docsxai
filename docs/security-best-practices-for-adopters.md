# Best practices for adopters

Operational practices we recommend for teams integrating docsxai.

## Install

- `npm install @docsxai/engine --ignore-scripts` (or the equivalent for the package you need — backend, viewer, plugin, skill). docsxai has no install-time scripts; the flag enforces it as defense in depth.
- Pin exact versions in `package.json` for high-assurance deployments (`"@docsxai/engine": "1.2.3"`, not `^1.2.3`).
- Commit your lockfile. Use `npm ci` or `pnpm install --frozen-lockfile` in CI; never loose `install`.

## Verify

- After install: `npm audit signatures` verifies the published Sigstore provenance attestation. Every docsxai package is published with `npm publish --provenance` from GitHub Actions OIDC, so the attestation chain ties each tarball to a specific commit + workflow run in `kalebteccom/docsxai`.
- Watch GitHub Security Advisories on `kalebteccom/docsxai` (subscribe via the repo's "Watch → Security advisories" setting).
- Watch for unexpected version jumps in `npm outdated` output — a published version that wasn't preceded by a tagged release on GitHub is a red flag.

## Plugin install model

The `@docsxai/plugin` package is a Claude Code plugin: it lands in `.claude/plugins/` and registers calibration skills + deterministic commands + an internal MCP. The plugin runs with the same privileges as your Claude Code session.

- Prefer `@docsxai/*` first-party packages.
- For third-party packages that extend docsxai (writeups, custom flow-file libraries), treat them like dependency reviews — read the source before installing.
- Vendor / version-pin via `@docsxai/skill` if you want a colocated fallback that lives inside your repo's `.claude/skills/` instead of being installed globally.

## Engine posture

The engine drives a Playwright instance against your running app. It writes only to its workspace dir; it does not modify the target app's repo. Two posture knobs to know:

- **`--workspace=<dir>`** — every artifact docsxai produces lives here. Treat this as untrusted output (it can contain rendered screenshots of your app's UI, which may include captured PII if your test data isn't clean).
- **Headed vs headless** — calibration runs headed by default so you can see what the agent is doing. For CI, headless. The engine does not exfiltrate anything off-host either way.

## CI hygiene for adopter pipelines

If you integrate docsxai into your own CI:

- Pin every GitHub Action by full SHA, not by tag (`uses: actions/checkout@b4ffde65...` not `uses: actions/checkout@v4`).
- Use `permissions: {}` at workflow level; elevate per-job only with the minimum scope needed.
- Avoid third-party GitHub Apps that require org-wide write access.
- Use `npm ci --ignore-scripts` in CI as a baseline.
- If your CI runs docsxai against a staging app, give it scoped credentials only — never production secrets.
