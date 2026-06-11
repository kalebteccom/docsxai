---
description: Validate the SITE_DOCS_TOKEN bearer token against a backend URL.
argument-hint: --backend-url <url>
---

Validate the current bearer token:

```
site-docs login $ARGUMENTS
```

Hits `/v1/health` (no-auth) + `/v1/workspaces` (bearer-gated) against the named backend and prints what it sees. Reads the token from `SITE_DOCS_TOKEN`; doesn't store anything.

The interactive OAuth 2.1 authorization-code-with-PKCE flow that production will use is post-MVP — until then, mint a workspace-scoped bearer token out-of-band and export it as `SITE_DOCS_TOKEN`. For CI, the same env-var path applies.
