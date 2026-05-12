---
description: Authenticate to the site-docs backend (interactive OAuth) or show how to set a CI token.
---

Run:

```
site-docs login
```

This starts the standard OAuth 2.1 authorization-code-with-PKCE flow against the backend — the same handshake
Claude Code runs for any MCP server. For CI / non-interactive use, the backend is reached with a pre-issued,
workspace-scoped bearer token in `SITE_DOCS_TOKEN` (no interactive login) — explain that if asked.
