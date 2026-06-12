# @docsxai/plugin-confluence

docsxai **publisher plugin** for Confluence Cloud. Registers `confluence:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`) and publishes it through the Confluence Cloud REST v2 API — idempotently.

The engine emits projections only and performs no wiki egress; this plugin is the Confluence egress path, declared in its manifest as `egress:*.atlassian.net` and gated by the workspace's `plugin_capabilities` opt-in. All HTTP uses the built-in `fetch`.

## Wiring

`.docsxai.json`:

```json
{
  "plugins": [{ "package": "@docsxai/plugin-confluence" }],
  "plugin_capabilities": ["egress:*.atlassian.net"]
}
```

Secrets come from the environment, never from config: `CONFLUENCE_TOKEN` (API token) and `CONFLUENCE_EMAIL` (the Atlassian account the token belongs to). The token is masked as `<CONFLUENCE_TOKEN>` (raw and Basic-auth-encoded forms) in every error and log line.

## Publish config

Passed as the publisher's `config`:

| Key              | Required | Meaning                                                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `base_url`       | yes      | Site origin, e.g. `https://acme.atlassian.net`.                                                              |
| `space_id`       | yes      | Target space id (v2 numeric id, as a string).                                                                |
| `mode`           | no       | Informational mirror of the projection's mode (`single` default, `page-tree` opt-in); the projection drives. |
| `page_map`       | no       | **Page identity**: `{ section → pageId }`. Sections present here are updated in place; absent ones created.  |
| `parent_page_id` | no       | Existing page to nest under (the single page, or the page-tree parent).                                      |
| `title_prefix`   | no       | Prepended to every page title, e.g. `"[Docs] "`.                                                             |

The result's `pages[]` entries each carry `section`, `id`, `url`, and `action` (`created` / `updated` / `unchanged`) — merge `{ [section]: id }` over your stored `page_map` to persist identity for the next publish.

Projection sections: `single` mode publishes one consolidated page (section `project`, flows as anchored H2 sections). `page-tree` mode publishes a parent overview (section `project`) plus one child page per flow (section = flow name).

## Idempotency

Every published page carries a `docsxai-content-sha` content-property: the sha256 of the page's projected content (title + ADF + attachment shas). On publish:

- property matches → `unchanged`, **zero** HTTP mutations (no version bump, no uploads);
- property differs → attachments whose same-name remote copy carries a matching `docsxai-sha256:<hex>` comment are skipped, the rest re-uploaded; then exactly one version-bump page update and a property bump;
- no `page_map` entry → page created, attachments uploaded, media nodes patched with the uploaded file ids, property set.

## Caveats

- Attachment upload posts multipart to `…/api/v2/pages/{id}/attachments`. Confluence Cloud currently exposes upload on the v1 `child/attachment` resource; revisit this endpoint before pointing the plugin at a real site.
- The plugin is in-process and unsandboxed, like every docsxai plugin — `trust: "kalebtec"` is a review signal, not a boundary.

## Tests

`pnpm test` (after `pnpm -r build` — the runtime-load test resolves the **built** package through the engine's real `resolvePlugins`). The suite runs an in-process fake Confluence v2 server on loopback that counts mutations: same projection published 3× → run 1 creates, runs 2–3 all `unchanged` with zero mutations; a prose change → exactly one page update; token-masking asserted against an error body that echoes the credential.

## License

[Apache-2.0](../../LICENSE).
