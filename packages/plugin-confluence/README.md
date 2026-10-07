# @docsxai/plugin-confluence

docsxai **publisher plugin** for Confluence Cloud. Registers `confluence:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`) and publishes it to Confluence Cloud — idempotently. Pages, properties and attachment listing use the REST v2 API; attachment upload uses the v1 `child/attachment` resource, the only upload endpoint Cloud offers.

The engine emits projections only and performs no wiki egress; this plugin is the Confluence egress path, declared in its manifest as `egress:*.atlassian.net` and gated by the workspace's `plugin_capabilities` opt-in. All HTTP uses the built-in `fetch`.

## Wiring

> **Repo-only.** `@docsxai/plugin-confluence` is not published to npm (`private: true`). Build it from a checkout (`pnpm -r build`) and wire it by path instead: `{ "path": "<checkout>/packages/plugin-confluence" }` (relative paths resolve from the workspace directory). The `{ "package": ... }` form below only resolves once the plugin is installed in the workspace's `node_modules`.

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

- Attachment upload posts multipart (`file`, `comment` = `docsxai-sha256:<hex>`, `minorEdit=true`, header `X-Atlassian-Token: no-check`) to `POST /wiki/rest/api/content/{pageId}/child/attachment`. The v2 attachments resource is read-only on Cloud (a POST answers 405), so v2 is only used to list existing attachments. Replacing an attachment of the same name posts to `…/child/attachment/{attachmentId}/data`, because v1 refuses a second attachment with the same file name. The media file id patched into the page body is `extensions.fileId` from the upload response.
- A failed publish throws a `ConfluencePublishError` whose `partial.pages` lists the pages written before the failure (same shape as `pages[]`: `id`, `url`, `action`, `section`), and logs them as a `page_map` fragment. If a page was created and an upload then failed, merge `{ [section]: id }` into `page_map` and publish again: the retry finds the page without its `docsxai-content-sha` property, updates it in place (uploading only the missing attachments) and creates no duplicate.
- The plugin is in-process and unsandboxed, like every docsxai plugin — `trust: "kalebtec"` is a review signal, not a boundary.

## Tests

`pnpm test` (after `pnpm -r build` — the runtime-load test resolves the **built** package through the engine's real `resolvePlugins`). The suite runs an in-process fake Confluence server on loopback (v2 attachment POST answers 405, uploads go to v1 `child/attachment`) that counts mutations: same projection published 3× → run 1 creates, runs 2–3 all `unchanged` with zero mutations; a prose change → exactly one page update; an upload failure after page creation leaves a retryable `page_map`; token-masking asserted against an error body that echoes the credential.

## License

[Apache-2.0](../../LICENSE).
