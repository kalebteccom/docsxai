---
description: Log in to the backend (bearer token check, or OAuth 2.1 + PKCE with --oauth).
argument-hint: --backend-url <url> [--oauth <workspace-dir>]
---

Arguments: `$ARGUMENTS`

Pass every value as its own single-quoted shell word (an embedded `'` is written `'\''`) and add nothing the user did not type. Validate the current bearer token:

```
docsxai login --backend-url '<url>'
```

Without `--oauth`, it hits `/v1/health` (no auth) and `/v1/workspaces` (bearer-gated) on the named backend and prints what it sees. It reads the token from `DOCSX_TOKEN` and stores nothing. CI uses this path. With `DOCSX_TOKEN` unset it exits 2 and shows the command to run.

With `--oauth <workspace-dir>`, it runs the interactive OAuth 2.1 authorization-code-with-PKCE flow: it prints a URL for the user to open in a browser, then stores the tokens at `<workspace-dir>/.auth/backend-token.json` (mode 0600). `push`, `pull` and `run` read them from there, with `DOCSX_TOKEN` taking precedence when both exist. The backend must expose the OAuth endpoints (`packages/backend` does). Never print the token or the file's contents.
