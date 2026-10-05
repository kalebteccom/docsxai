---
description: Log in to the backend (bearer token check, or OAuth 2.1 + PKCE with --oauth).
argument-hint: --backend-url <url> [--oauth <workspace-dir>]
---

Validate the current bearer token:

```
docsxai login $ARGUMENTS
```

Without `--oauth`, hits `/v1/health` (no-auth) + `/v1/workspaces` (bearer-gated) against the named backend and prints what it sees. Reads the token from `DOCSX_TOKEN`; doesn't store anything. CI uses this path.

With `--oauth <workspace-dir>`, runs the interactive OAuth 2.1 authorization-code-with-PKCE flow: it prints a URL to open in a browser, then stores the tokens at `<workspace-dir>/.auth/backend-token.json`. The backend must expose the OAuth endpoints (`packages/backend` does).
