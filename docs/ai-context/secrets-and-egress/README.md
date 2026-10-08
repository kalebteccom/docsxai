# Trust posture — what writes to disk, what gets sent over the wire

The engine never executes JavaScript the visited site provides in any privileged context. Page interaction goes through Playwright's locator API and a curated, finite step vocabulary (`click`, `fill`, `select`, `wait_for`, `assert`, …); nothing in a flow-file is `eval`'d. There is no in-engine `eval_js` surface and no general-purpose JS-injection capability — that boundary is load-bearing.

What the trust surface _does_ cover:

- **Auth-strategy artifacts can carry secrets.** A `manual-capture` flow caches a session cookie / `storageState` in the workspace. That cookie is the keys-to-the-kingdom against the target site.
- **Doc-pack artifacts can carry visual secrets.** Screenshots from a calibration run can capture PII, OAuth flow tokens visible in URLs, customer data on the target page. The viewer overlay logic stays clean; the underlying PNG bytes are whatever Chromium painted.
- **Halt context (`diagnose` output) can carry page state.** The serialized halt record names locators, attempted actions, and snippets of the page DOM at halt time.

## Egress chokepoints

- **`packages/engine/src/workspace.ts` — `resolveWorkspacePath`.** All filesystem writes go through this. No `cwd`-relative paths in any handler. Every artifact lands under the operator-provided workspace root and nowhere else.
- **`packages/engine/src/backend-client.ts`.** The engine's only built-in outbound HTTP path (other than the target-site navigation Playwright drives). Configured with the operator's bearer token; bound to the configured backend URL. Wiki/VCS egress lives exclusively in capability-declared publisher plugins and the backend — the engine core emits projections (files/payloads) only.
- **`packages/engine/src/egress-guard.ts`.** Opt-in request guard for the browser a run drives (`DOCSX_EGRESS_GUARD=1`, or `launchPlaywrightSession({ egressGuard })`). Every request, redirect hop and WebSocket of the context is checked: a host that is, or resolves to, a link-local or cloud-metadata address is aborted (`DOCSX_EGRESS_DENY_PRIVATE=1` adds loopback and private ranges), and a lookup that fails aborts too. The printed reason is generic (`address not allowed`). It does not stop DNS rebinding, and it cannot block service workers on a CDP-attached context. Off for a local `run`; the backend runner turns it on for webhook runs, and the MCP HTTP transport turns it on for the browser `run_flows` starts.
- **`packages/engine/src/doc-pack-io.ts` — `assertSafePackNames`.** `pull` checks every file name in a backend response before the first write and refuses the whole revision on one name a workspace would not produce (a flow file that is not `<flow name>.flow.yaml`, an annotations or screenshots path outside `docs/<flow>[/<variant>]/`, names that differ only by case). The backend is not trusted with names.
- **`packages/backend/src/server.ts`.** Loopback-bound by default. OAuth 2.1 + PKCE and CI bearer-token auth (`docsxai login --oauth`); hosted multi-tenant deployment is post-MVP. No code-execution surface beyond CRUD on doc-pack resources.

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

Per-strategy secret handling + the masking-before-write order: [`auth-catalogue-and-masking.md`](auth-catalogue-and-masking.md).
