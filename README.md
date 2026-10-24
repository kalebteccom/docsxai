<p align="center">
  <img src="brand/docsxai-favicon.svg" width="96" height="96" alt="docsxai">
</p>

# docsxai

> **Turn a real web app into step-by-step, screenshot-rich user guides that stay current automatically.**

docsxai walks your web application, follows flows you describe in plain files, and emits documentation with clean, annotated screenshots — halos, numbered badges, callouts, captions. You teach it a flow **once**; after that it replays the same flow headlessly, on demand, producing the same docs every time. The core engine never calls a model API, so regenerating your docs on every commit is cheap and reproducible instead of expensive and flaky.

**Who it's for.** Product, platform, and docs engineers who maintain end-user documentation for a web app — especially an authenticated SPA whose UI changes often enough that hand-maintained screenshots go stale. Two roles share the workflow:

- a **calibration author** (often working through an AI coding agent like Claude Code or Codex over MCP) who teaches docsxai a user flow once;
- a **CI / automation owner** who then re-runs `docsxai run` on every commit to regenerate the docs deterministically — no LLM calls, no agent in the loop.

**What you can do with it:**

- Keep an authenticated SaaS app's user guide in sync — calibrate the key flows once, regenerate annotated screenshots on every release so the docs never show stale UI.
- Catch documentation drift in CI — `docsxai baseline` + `docsxai diff --fail-on warn` flags a PR whose UI change breaks a documented flow, before it merges.
- Publish a polished docs site — emit an Astro Starlight site or a single-file interactive viewer with per-step screenshots, callouts, and captions.
- Push the same docs into an existing knowledge base — idempotent Confluence Cloud publishing, so re-running an unchanged flow makes zero edits and only real changes land.
- Document flows that need login and clean data — capture an authed session (interactive manual capture or one of ten scripted strategies, eleven in all) and apply deterministic redactions so secrets and PII never reach a screenshot.

## How it works: two modes

The thing that makes docsxai's cost story honest is a clean split between an expensive step you run rarely and a cheap step you run constantly.

- **Calibration — AI-assisted, rare.** A host agent (Claude Code, Codex, or anything that speaks MCP) drives the discovery → mapping + testing → commit pipeline through the engine's CLI and a browser bridge ([browxai](https://github.com/kalebteccom/browxai) is the canonical model-agnostic driver). The output is a self-sufficient **doc pack**: flow files, `annotations.json`, `style.yaml`, per-step markdown, screenshots, a locator manifest, and an auth-strategy descriptor. You pay for an agent here, once.
- **Execution — deterministic, continuous.** `docsxai run` replays the doc pack through headless Playwright. No agent, no MCP, no model calls. Same input → same output. This is what runs in CI on every commit.

Per-commit LLM runs would be untenable; per-commit Playwright runs are standard. That's the whole bet.

## Install

You need [Node 26+](https://nodejs.org/). Check with `node --version`.

```bash
npm install -g docsxai@next     # or: pnpm add -g docsxai@next
npx playwright-core install chromium
docsxai doctor
```

- `docsxai` is the CLI plus the viewer, in one package.
- `@next` is the 0.3 line, currently `0.3.0-rc.3` (`pack`, `--verify-determinism`, matrix flows). `latest` is `0.2.0`, which has none of those. `latest` moves when 0.3 ships stable, then the pin should move too.
- With pnpm, run `pnpm setup` once first, or the global install has no bin directory on your PATH.
- Chromium is a separate download. It never runs as an install script, so you fetch it once yourself.
- `docsxai doctor` checks Node, Chromium and the viewer. Each failing row prints its fix.
- Granular install: `npm install -g @docsxai/engine@next @docsxai/viewer@next`.

Claude Code users can also install the plugin (calibration skills and the `/docsxai:*` commands) from this repo's marketplace. The plugin runs the `docsxai` CLI, so install the CLI first.

```
/plugin marketplace add kalebteccom/docsxai
/plugin install docsxai@docsxai
```

To try a checkout without installing, run `claude --plugin-dir /path/to/docsxai/packages/plugin`. See [`packages/plugin`](packages/plugin/).

Building from source is for contributors. See [CONTRIBUTING.md](CONTRIBUTING.md).

## First run in 10 minutes

Four words you will meet:

- A **workspace** is a folder docsxai writes into. Keep it outside your app's repo.
- A **flow** is a YAML file that lists steps: open a page, click a button, check something is visible. One flow is one user guide.
- To **calibrate** is to write a flow for the first time. You or an AI agent do it once.
- A **doc pack** is what a run leaves in the workspace: per flow, an `annotations.json` and its screenshots, next to the flow and style files that produced them.

This walkthrough documents `example.com`, so it needs no login and no app of your own.

```bash
# 1. Make a workspace with the example flow. No login needed.
docsxai init ~/docsxai/hello --example

# 2. Run it. This launches headless Chromium, so the Chromium download from Install must be done.
docsxai run ~/docsxai/hello

# 3. Build the viewer and open it in your browser.
docsxai render ~/docsxai/hello --open
```

A good run prints `run: 1 of 1 flow ok, outputs in …/docs`. The screenshot and `annotations.json` are in `~/docsxai/hello/docs/hello/`. In the viewer, hover the pulsing halo to read the callout.

The flow `init` wrote is `~/docsxai/hello/flows/hello.flow.yaml`. One step opens the home page and points at its heading:

```yaml
name: hello
locators:
  heading: "h1"
steps:
  - id: open-home
    action: navigate
    value: /
    wait_for: load
    success: { visible: $heading }
    annotation: { copy: "This is the page title", target: $heading, arrow: bottom }
```

To document your own app, make the workspace with your app's URL and add a login capture:

```bash
# Add --ignore-https-errors if the app runs on a self-signed dev certificate.
docsxai init ~/docsxai/my-app --app-url https://localhost:3000 --auth manual-capture --ttl 1h
# A Chrome window opens. Log in, then run window.__docsxai.capture() in its devtools console.
docsxai capture-auth ~/docsxai/my-app
```

Then write flows for your app. `docsxai inspect ~/docsxai/my-app` lists the page's `data-testid` elements to pin locators on. To let an AI agent write the flows, hand it [`docs/agent-runbook.md`](docs/agent-runbook.md).

When something fails, every error ends with a `next:` line naming the command to run. The usual ones:

| You see                                    | Do this                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `no Chromium binary found`                 | `npx playwright-core install chromium`                                                                         |
| `no flow-files in …/flows`                 | Add one with `docsxai calibrate <workspace> --from <flow.yaml>`.                                               |
| `no valid cached session`                  | `docsxai capture-auth <workspace>`, then run again.                                                            |
| A step halted with a `[cause]` in brackets | `docsxai diagnose <workspace> --flow <name> --step <step-id>`. The halt screenshot is in `docs/<flow>/halts/`. |
| The app is unreachable                     | Start the app. Check `app_url` in `<workspace>/.docsxai.json`, or pass `--base-url`.                           |
| Anything else                              | `docsxai doctor <workspace>`                                                                                   |

Next: [quickstart on docsxai.dev](https://docsxai.dev/getting-started/quickstart/), the [agent runbook](docs/agent-runbook.md), [CI recipes](docs/ci-recipes.md) and the [CLI reference](https://docsxai.dev/reference/cli/). For the fast calibration loop (`lint`, `flow-tree`, `diagnose`, `style --check`, `run --start-from --cdp`), see the runbook.

## CLI reference

`docsxai --help` lists every command, flag, and the inline `Notes:` block with per-command detail. The full reference — every command and flag, rendered per command — lives at the [CLI reference](https://docsxai.dev/reference/cli/).

## Packages

| package                                                     | role                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@docsxai/engine`](packages/engine/)                       | The LLM-agnostic engine: flow-file parser + deterministic runtime (environment controls, redaction), the plugin runtime, the 11-strategy auth catalogue, pure exporters (ADF), and the full `docsxai` CLI. |
| [`@docsxai/plugin`](packages/plugin/)                       | Claude Code plugin — calibrate + diagnose skills; run/render/login/push/pull/doctor/plugins/export commands. The recommended surface for agent-driven workflows.                                           |
| [`@docsxai/viewer`](packages/viewer/)                       | Rendering surface: interactive single-file viewer, browser-free `burn` renderer (baked annotations), and the Astro Starlight docs-site emitter.                                                            |
| [`@docsxai/backend`](packages/backend/)                     | Doc-pack persistence service: FS or in-memory store, content-addressed blobs, finalized linear-immutable revisions, OAuth 2.1 + PKCE, encrypted auth-cache relay, GitHub App webhook surface.              |
| [`@docsxai/skill`](packages/skill/)                         | Optional vendorable `.claude/skills/` fallback; delegates to the installed plugin. For teams that prefer version-pinning in the consumer repo.                                                             |
| [`@docsxai/mcp`](packages/mcp/)                             | Standalone stdio MCP server: calibration meta-orchestration + doc-pack introspection for any MCP host (no browser primitives — browxai owns discovery).                                                    |
| [`@docsxai/plugin-confluence`](packages/plugin-confluence/) | First-party publisher plugin — idempotent Confluence Cloud REST v2 push (`confluence:push`), capability-gated egress.                                                                                      |
| [`@docsxai/plugin-gitbook`](packages/plugin-gitbook/)       | First-party publisher plugin. Markdown pages and images into a GitBook space through a change request (`gitbook:push`), capability-gated egress.                                                           |
| [`@docsxai/plugin-guru`](packages/plugin-guru/)             | First-party publisher plugin. Cards with attached images in a Guru collection through the Guru public API (`guru:push`), capability-gated egress.                                                          |
| [`@docsxai/plugin-notion`](packages/plugin-notion/)         | First-party publisher plugin. Pages with uploaded images under a Notion page or in a database through the Notion public API (`notion:push`), capability-gated egress.                                      |
| [`@docsxai/plugin-sharepoint`](packages/plugin-sharepoint/) | First-party publisher plugin. Markdown and images into a SharePoint Online document library through Microsoft Graph (`sharepoint:push`), capability-gated egress.                                          |
| [`@docsxai/plugin-starlight`](packages/plugin-starlight/)   | First-party renderer plugin — Starlight site emission (`starlight:site`).                                                                                                                                  |

`@docsxai/mcp`, `@docsxai/plugin-confluence`, `@docsxai/plugin-gitbook`, `@docsxai/plugin-guru`, `@docsxai/plugin-notion` and `@docsxai/plugin-starlight` are repo-only (`private: true`, not on npm). The other packages, and the bare `docsxai`, are published (`@docsxai/plugin-sharepoint` since `0.3.0-rc.3`, experimental): `0.2.0` is on `latest`, `0.3.0-rc.3` on `next`.

## Documentation

- [**docs/agent-runbook.md**](docs/agent-runbook.md) — hand-it-to-an-agent workflow runbook
- [**docs/agent-guidance.md**](docs/agent-guidance.md) — the reach-for-this-not-that list for agents that write flows
- [**docs/running-against-an-app-repo.md**](docs/running-against-an-app-repo.md) — human-readable runbook
- [**docs/ci-recipes.md**](docs/ci-recipes.md) — wiring `run` / `baseline` / `diff` into CI
- [**docs/themed-caption-packs.md**](docs/themed-caption-packs.md) — raw captures to themed, hash-named screenshots with a manifest
- [**docs/actionability-contract.md**](docs/actionability-contract.md) — the portable `actionable()` predicate contract, for browser-bridge consumers
- [`CHANGELOG.md`](CHANGELOG.md) — release notes · [`RELEASING.md`](RELEASING.md) — release process

## Contributing

See [**CONTRIBUTING.md**](CONTRIBUTING.md).

## License

Code is [Apache-2.0](LICENSE).

The **docsxai name and logo are trademarks of Kalebtec** and are not
covered by the Apache License (Apache-2.0 §6 withholds trademark
rights). The brand assets under [`brand/`](brand/) are
all-rights-reserved (see [`brand/LICENSE`](brand/LICENSE)). See
[TRADEMARKS.md](TRADEMARKS.md) for the full brand policy.
