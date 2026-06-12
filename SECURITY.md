# Security Policy

docsxai is an LLM-agnostic documentation engine plus a Claude Code
plugin and a small authenticated backend. Its threat surface is shaped
by two facts: the engine ships **no model-API surface and no
arbitrary-code-execution surface** — it parses flow-files against a Zod
schema, drives Playwright through a curated step vocabulary, and emits
screenshots and text — and the backend is a stateless HTTP service
bound to loopback by default. This document tells you what we will and
will not commit to, and how to report a vulnerability.

## Supported versions

docsxai is **pre-v1.0** and unpublished. At the public flip the bare
`docsxai` npm name is claimed with a typosquat-defensive stub that throws
on import (see [`RELEASING.md`](RELEASING.md)); the real packages ship at
v1.0. Until then:

| Version range              | Support level                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.x` (pre-release)        | Pre-release versions carry no security guarantees. `security@kalebtec.com` still triages reports in good faith and ships fixes on a best-effort basis on the active branch. |
| `1.(latest).x` (post-v1.0) | Patches for any qualifying vulnerability.                                                                                                                                   |
| `1.(latest-1).x`           | Critical only.                                                                                                                                                              |
| `1.(latest-2).x` and older | No support. Upgrade.                                                                                                                                                        |

"Critical" means: remote code execution, secrets exfiltration (auth-
strategy cache leak), workspace escape, or backend auth bypass.
Everything else is "qualifying."

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

**Primary channel:** GitHub Security Advisories. From the
[docsxai repository](https://github.com/kalebteccom/docsxai), open the
**Security** tab and choose **"Report a vulnerability"**. This creates a
private advisory thread visible only to you and the maintainers.

**Fallback channel:** email `security@kalebtec.com` with the subject
prefix `[docsxai-security]`. Use this only if GitHub Security Advisories
is unavailable to you.

Please include:

- docsxai version (output of `docsxai --version` or the relevant
  package's `package.json`).
- Component (engine / plugin / backend / viewer / skill).
- Node version and OS.
- Minimal reproduction: a flow-file fragment, the CLI invocation, a
  backend request payload, or a viewer-loadable doc pack.
- Your assessment of impact and severity.

## What to expect

- **Acknowledgement:** within 48 business hours.
- **Initial assessment:** within 7 calendar days. We tell you whether
  the report is in scope, the severity we assign, and the patch path.
- **Critical patch target:** 30 days from confirmed report.
- **Lower-severity patch target:** 90 days from confirmed report.
- **Coordinated disclosure:** patch-then-disclose is the default. We
  publish the advisory once a fixed version is released and adopters
  have a window to upgrade. Embargo will not exceed 90 days from
  confirmed report without your written agreement.
- **Credit:** reporters are credited in the CHANGELOG entry and the
  GitHub Security Advisory by name and (optional) affiliation, unless
  you ask to be omitted.

## In scope

Reports against the following are in scope:

- **Workspace-escape path traversal** — any engine path that reads or
  writes outside the configured workspace root via path traversal,
  symlink follow, or `..` segments. The workspace boundary is the
  filesystem trust boundary; the engine's job is to not cross it.
- **Auth-strategy cache leak** — cached cookies, tokens, or auth headers
  appearing in any externally-visible sink (logs, doc-pack artifacts,
  viewer output, halt context, zip output, screenshots).
- **Flow-file schema bypass** — any malformed flow-file payload reaching
  the runtime past the Zod schema boundary, especially anything that
  shifts behavior into arbitrary code execution.
- **In-page script injection** — any path that ships agent-supplied or
  flow-file-supplied JavaScript into the page beyond the curated step
  vocabulary. The engine has no `eval`-shaped step; introducing one
  without an explicit threat-model entry is in scope.
- **Backend auth bypass** — any request reaching authenticated backend
  endpoints without a valid OAuth 2.1 credential, or any path that
  serves one tenant's doc pack to another.
- **Viewer XSS / HTML injection** — any flow-file or annotation content
  reaching the rendered viewer as live HTML rather than escaped text.
- **Loopback escape** — the backend defaults to loopback binding; any
  default configuration that exposes it on a non-loopback interface
  unintentionally is in scope.
- **Plugin manifest trust bypass** — any path through the Claude Code
  plugin that escalates beyond the declared plugin permissions.

## Out of scope

The following are not docsxai vulnerabilities:

- Vulnerabilities in upstream Playwright, Chromium, Node.js, or
  Claude Code that do not also have a docsxai-specific code path.
  Report those to their respective projects.
- Findings that require an attacker who already controls the operator's
  shell, workspace, or auth-strategy cache. We do not defend against
  local-root attackers.
- Social engineering, physical access, and denial-of-service via
  resource exhaustion on the operator's own machine.
- Issues in adopter-side configuration (exposing the backend beyond
  loopback on an untrusted network, running docsxai with
  elevated OS privileges, calibrating against a hostile target site).
- Issues in third-party flows or doc packs distributed by adopters.
  Report those to the doc pack's owner.

## Trust posture — what we promise, what we do not, what we cannot prevent

**What we promise.** The published `@docsxai/*` packages,
installed from npm with provenance verified (`npm audit signatures`),
have no built-in code-execution surface beyond what Playwright itself
exposes through the curated step vocabulary. The engine never imports
a model-provider SDK, and that constraint is a contract violation if
broken. The flow-file parser validates against a Zod schema before
anything runs. The backend defaults to loopback. No lifecycle script
runs at install time.

**What we DO NOT promise.** docsxai operates on whatever target site
the operator points it at. The engine cannot tell whether the target
site is hostile. If the operator calibrates against a malicious site:
that site cannot escape the page (Playwright + Chromium do their job),
but the operator's screenshots, captured text, and any auth tokens
cached for that target ARE controlled by the operator's input. The
operator is responsible for the trust posture of the targets they
point the engine at.

**What we cannot prevent.** If an adopter installs a typosquat
(`docsxa`, `dcosxai`, `docsx-ai`, `site-doc`, etc.) instead of
`docsxai` / `@docsxai/*`, our defenses do not apply. Verify
the package name and scope before install; verify provenance after
install. See `docs/security-best-practices-for-adopters.md` (lands
with the launch-gate phase).

## Plugin trust model

The Claude Code plugin (`@docsxai/plugin`) runs inside Claude
Code's plugin sandbox and delegates execution to the engine binary —
it does not embed its own runtime. Plugin skills emit structured
questions and shell out to `docsxai`; plugin commands are
deterministic engine invocations. The plugin does not introduce a new
code-execution surface beyond what the engine already exposes.

The `@docsxai/skill` package is an optional vendorable
`.claude/skills/` fallback that delegates to the installed plugin
for teams that prefer version-pinning in the consumer repo. The same
trust posture applies — `skill` is a thin redirect, not a parallel
runtime.

Third-party docsxai integrations are not reviewed by Kalebtec. Report
issues in them to their maintainers.

## Bug bounty

**None.** docsxai is a solo-maintained Apache-2.0 project with no
hosted offering at this stage and no monetisation. We cannot pay
bounties. We can and do credit reporters publicly (with consent) and
coordinate disclosure seriously.

## Bot allowlist policy

The repository enforces a strict GitHub App allowlist; bots commonly
installed for security scanning (Snyk, Sonatype, Mend, Socket.dev,
Codecov, etc.) are **not** installed and will not be invited. The
rationale: each installed App expands the trusted-write surface to a
third party whose own compromise becomes our compromise, and the
findings these tools surface are already covered by first-party CI
(`pnpm audit`, secret scanning, `zizmor`, license-checker, lockfile
lint). Once the bot allowlist artifact lands in `.github/`, that file
holds the canonical policy. Adding a new App that requires write
access requires explicit owner approval and a rationale entry there.
