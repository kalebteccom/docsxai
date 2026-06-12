---
title: Auth strategies
description: Getting site-docs through your app's login - manual capture for interactive sessions and scripted strategies for unattended CI re-auth.
---

Every auth strategy reduces to the same artifact: a cached `storageState`
(cookies plus localStorage), optionally with connection-level context options
(`httpCredentials`, `extraHTTPHeaders`, `clientCertificates`), so the rest of
the suite stays auth-agnostic. `site-docs capture-auth` covers the interactive
case: log in once in a real browser and pin the session. For unattended
re-auth in CI, declare a scripted strategy in `auth/strategy.yaml`; credential
values are referenced by env-var name (`creds_env`) and never appear in the
descriptor, the artifacts, or error messages.

This page will grow into the per-strategy reference, including user pools for
parallel workers.
