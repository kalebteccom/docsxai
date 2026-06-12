# Capability + posture map — what's on by default, what's gated

Read this when adding any surface that acts on the world: an MCP tool, a
plugin kind, an auth strategy, a backend route, an output strategy.

## The lattice

| Surface                                      | Default                 | Gate                                                            |
| -------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| Engine CLI (run/render/lint/diagnose/…)      | on                      | workspace-rooted IO only (`resolveWorkspacePath`)               |
| Engine outbound HTTP                         | backend client only     | `backend_url` opt-in in `.docsxai.json`                         |
| Publisher plugins (wiki/VCS egress)          | **off**                 | manifest `egress:<host-glob>` ⊆ workspace `plugin_capabilities` |
| Renderer / lint-rule / auth-strategy plugins | off                     | declared in `.docsxai.json` `plugins` + lock verification       |
| Backend webhook endpoint                     | off                     | per-project `webhook-config` + HMAC secret + `enabled`          |
| Backend OAuth auto-approve                   | off                     | `DOCSX_OAUTH_AUTO_APPROVE=1` or CI bearer                       |
| Encrypted auth-cache relay                   | off                     | `store: backend` + `DOCSX_CACHE_KEY` + pushed workspace         |
| MCP server tools                             | on (read + orchestrate) | no browser primitives by design; workspace validation           |
| `manual-capture` instrumented Chrome         | operator-invoked        | headed, human in the loop                                       |

Composition is multiplicative: a wiki push from a webhook needs the webhook
gate AND the plugin capability AND the publisher's env secrets — each layer
denies independently.

## Rules

- **Structured denial, never silent no-op.** A gated surface that isn't
  enabled returns a typed error naming the gate and the enabling step
  (`disabled-by-capability-mismatch`, "set DOCSX_CACHE_KEY", 401 with
  `WWW-Authenticate`). Tests cover the denial path as a first-class case.
- **Every new gate gets a denial test** before the happy-path test counts.
- **Off-by-default is the default.** Anything that writes outside the
  workspace, leaves the machine, or holds a secret starts gated; "on by
  default" requires this file to be amended deliberately.
- New rows land here in the same diff that adds the surface.
