# @kalebtec/docsxai-backend

Authenticated service that persists doc packs (projects, revisions, flow-files, screenshots, annotations, style artifacts, run history). REST + per-resource endpoints; bearer-token auth (OAuth 2.1 is the Phase-2 path).

**Status:** stub backend with the concrete endpoint list (`api.ts: ROUTES`), in-memory linear-immutable revisions, and an HTTP stub server. The endpoint shape is what production will be; the persistence layer (filesystem / DB) and the OAuth 2.1 interactive flow are deferred to Phase 2 — MVP workflows use local file output (`--persist tmp` and `site-docs zip` for hand-off).

## Surface

- **`ROUTES`** in `src/api.ts` — the canonical endpoint list. `/v1/workspaces/{ws}/projects/{p}/revisions/{rev}/{flows|annotations|screenshots|style|locators|run-history}`. Versioned via the `Site-Docs-API-Version` header.
- **Linear immutable revisions** — every `calibrate` / `run` / human edit creates a new revision with `rev_id` / `parent_rev_id` / `kind` / `author` / `timestamp`. No branches in MVP; concurrent-edit conflicts surface as failed pushes resolved via re-pull + re-edit.
- **`createBackendStub`** — starts the in-memory server bound to a port; useful for plugin-side integration tests.
- **`docsxai-backend`** bin — the same stub as a standalone process.

Design: `projects/automated-site-documentation-bot/spec.md` in the [`project-ideas`](https://github.com/kalebteccom/project-ideas) portfolio.

## License

[Apache-2.0](../../LICENSE).
