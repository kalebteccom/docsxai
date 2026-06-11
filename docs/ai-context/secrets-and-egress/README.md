# Trust posture — what writes to disk, what gets sent over the wire

The engine never executes JavaScript the visited site provides in any privileged context. Page interaction goes through Playwright's locator API and a curated, finite step vocabulary (`click`, `fill`, `select`, `wait_for`, `assert`, …); nothing in a flow-file is `eval`'d. There is no in-engine `eval_js` surface and no general-purpose JS-injection capability — that boundary is load-bearing.

What the trust surface _does_ cover:

- **Auth-strategy artifacts can carry secrets.** A `manual-capture` flow caches a session cookie / `storageState` in the workspace. That cookie is the keys-to-the-kingdom against the target site.
- **Doc-pack artifacts can carry visual secrets.** Screenshots from a calibration run can capture PII, OAuth flow tokens visible in URLs, customer data on the target page. The viewer overlay logic stays clean; the underlying PNG bytes are whatever Chromium painted.
- **Halt context (`diagnose` output) can carry page state.** The serialized halt record names locators, attempted actions, and snippets of the page DOM at halt time.

## Egress chokepoints

- **`packages/engine/src/workspace.ts` — `resolveWorkspacePath`.** All filesystem writes go through this. No `cwd`-relative paths in any handler. Every artifact lands under the operator-provided workspace root and nowhere else.
- **`packages/engine/src/backend-client.ts`.** The only outbound HTTP path (other than the target-site navigation Playwright drives). Configured with the operator's bearer token; bound to the configured backend URL.
- **`packages/backend/src/server.ts`.** Loopback-bound by default. Bearer-token auth (OAuth 2.1 is the Phase-2 path). No code-execution surface beyond CRUD on doc-pack resources.

## Discipline for new code paths

A new code path that writes to disk:

- [ ] Routes the path through `resolveWorkspacePath`.
- [ ] Honors the workspace argument from the CLI as the only root.
- [ ] Does not log full file contents to console / stdout / recorder unless the operator opted in (`--verbose`, `--debug`, etc.).
- [ ] Does not include the auth cookie in any halt context, diagnose output, or doc-pack artifact.

A new code path that emits text to the operator:

- [ ] Does not include cookie values from cached `storageState`.
- [ ] Does not include `Authorization` headers from outbound HTTP.
- [ ] Truncates page-DOM snippets when including them in halt context.

A new outbound HTTP path:

- [ ] Goes through `backend-client.ts` if it's the docsxai backend; otherwise it's an architectural violation (the engine has exactly one outbound HTTP destination at runtime, plus the Playwright-driven target site).
- [ ] Authenticated via bearer token from the operator's environment.
- [ ] Loopback by default; non-loopback requires the operator to configure the backend URL explicitly.

## What the engine deliberately does NOT do

- **Never executes site-provided JavaScript in any privileged context.** The flow-file step vocabulary is finite and curated; nothing in a flow is `eval`'d. No `eval_js` tool, no `poll_eval`, no canvas-app routing.
- **Never reads beyond the target URLs the operator provides.** The runtime navigates to the URLs the flow-file names, plus whatever the target site links to in the documented step sequence. No crawler-like discovery; no auto-spidering.
- **Never calls a model API.** The engine has no provider SDK in its dependency graph. Inference is the host agent's job at calibration time; execution is inference-free.

## Related

- [`../architecture/surface-map.md`](../architecture/surface-map.md) — the load-bearing boundaries.
- [`../../../AGENTS.md`](../../../AGENTS.md) — "Trust + execution posture" section.
- [`../../../SECURITY.md`](../../../SECURITY.md) — vulnerability reporting + trust posture.
