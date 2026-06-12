---
title: Backend API
description: The docsxai backend's REST surface - projects, revisions, blobs, runs, OAuth 2.1 auth, and the GitHub App webhook.
---

The backend is a small authenticated service that persists doc packs:
projects, revisions, flow-files, screenshots, annotations, style artifacts,
and run history. Authentication is OAuth 2.1 (authorization-code with PKCE)
plus a pre-issued CI bearer token; blob storage is content-addressed; and
finalized revisions are immutable. The `site-docs push` and `pull` commands
are the CLI clients of this API, and the docsxai GitHub App drives doc
refreshes through its webhook endpoint.

This page will grow into the endpoint-by-endpoint reference, including the
`Site-Docs-API-Version` header contract.
