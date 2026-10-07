# @docsxai/plugin-notion

docsxai **publisher plugin** for Notion. Registers `notion:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`), converts each document to Notion blocks and creates or rewrites one page per document, under a parent page or as rows of a database, with its screenshots uploaded through the Notion file upload API and attached as image blocks. A second push of unchanged content performs zero writes.

The engine emits projections only and performs no wiki egress. This plugin is the Notion egress path. Its manifest declares exactly one capability, `egress:api.notion.com`, which the workspace's `plugin_capabilities` has to opt into. All HTTP uses the built-in `fetch`.

> **Repo-only.** `@docsxai/plugin-notion` is not published to npm (`private: true`). A new publishable package needs an npm trusted-publisher binding first, and that is not set up. Build it from a checkout (`pnpm -r build`) and wire it by path: `{ "path": "<checkout>/packages/plugin-notion" }` (relative paths resolve from the workspace directory).

## Wiring

`.docsxai.json`:

```json
{
  "plugins": [{ "path": "<checkout>/packages/plugin-notion" }],
  "plugin_capabilities": ["egress:api.notion.com"]
}
```

The token comes from the environment, never from config or the repo. The publisher reads the variable named in `secretsEnv.token` (default `NOTION_TOKEN`) and sends it as `Authorization: Bearer <token>`. It is an internal integration token (or an OAuth access token), and the integration has to be shared with the parent page or database in Notion (the page's Connections menu) with insert, update and read content capabilities. The token is masked as `<NOTION_TOKEN>` in every error and log line, including when Notion echoes it back in an error body.

## Publish config

Passed as the publisher's `config`:

| Key                | Required   | Meaning                                                                                                                        |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `parent_page_id`   | one of two | Id of the page the document pages are created under.                                                                           |
| `database_id`      | one of two | Id of the database the document pages are created in, one row each. Setting both is an error.                                  |
| `title_property`   | no         | Name of the database's title property, `Name` by default. Only read with `database_id`.                                        |
| `base_url`         | no         | `https://api.notion.com/v1`, the only value accepted. See the allowlist below.                                                 |
| `title_prefix`     | no         | Prepended to every page title, e.g. `"[Docs] "`.                                                                               |
| `force`            | no         | `true` rewrites every page even when the manifest says it is unchanged.                                                        |
| `manifest_page_id` | no         | Id of the manifest page. The plugin logs it after the first push, and passing it back skips the lookup that finds it by title. |

Ids are UUIDs, with or without dashes. `base_url` is pinned: `https` on `api.notion.com`, default port, path `/v1`, no credentials, query or fragment. Anything else fails before the first request, so the token cannot be sent to another host through config. Plain `http` on a loopback host is accepted only through a constructor option of `createNotionPublisher` that tests use against the fake server. Config cannot set it. Capabilities gate which plugins load and are a review signal, not a network sandbox.

## Design decisions

**API version.** Every request sends `Notion-Version: 2022-06-28`. The current stable version is `2026-03-11`. Its documented breaking changes (`position` replaces `after` on append, `archived` becomes `in_trash`, `transcription` becomes `meeting_notes`) touch nothing this plugin calls, but `2025-09-03` removed `database_id` as a page parent in favour of `data_source_id`, and a page parent plus a database parent is what the config offers. Version `2022-06-28` accepts both and has the file upload API. The cost: a database with more than one data source is not reachable on this version. Moving to a newer version means resolving the database's data source id (`GET /v1/databases/{id}`) first, and it is not done yet.

**Page content as blocks.** The ADF projection becomes headings (`heading_1` to `heading_3`, deeper levels clamp to 3), paragraphs, bulleted and numbered list items, `code` blocks (language `plain text`) and image blocks. Bold, italic, inline code and links (kept only when http, https or mailto) become rich text annotations. Notion caps a rich text item at 2000 characters and an array at 100 items, so longer text is split, and past 100 items it continues in another block of the same type. Nested lists are not rendered: a list item keeps its first paragraph, as in the Guru and SharePoint plugins.

**Create, then rewrite in place.** A new document is `POST /pages` (title only), then its blocks are appended with `PATCH /blocks/{id}/children` in requests of at most 100 blocks and 400 KB. Notion has no call that replaces a page's children, so a changed document is `PATCH /pages/{id}` for the title, then every content block is deleted (`DELETE /blocks/{id}`, one call each) and the new blocks are appended. A page with many blocks therefore costs many deletes. A `child_page` or `child_database` block is somebody's nested page, so those are never deleted. The page id and URL stay the same.

**Images through the file upload API.** Each screenshot the page uses goes through `POST /file_uploads` (filename, `image/png`) and `POST /file_uploads/{id}/send` (multipart, field `file`), and the page gets an `image` block of type `file_upload` with the alt text as caption. The send URL is built from the validated upload id, not taken from the create response. An upload that no block uses expires an hour after it is made, so the plugin deletes the old blocks first, then uploads, then appends right away, and an unchanged page uploads nothing. External URL blocks are not used (they would need image hosting outside Notion). The single-part upload takes files up to 20 MiB: a larger screenshot is published as a paragraph naming the file and its size, and the push logs a warning.

**Idempotency through a manifest page.** A page created through the API has no custom property to hold data (a page under a page has only a title), and a database property would have to exist in the schema first. So the plugin keeps one page titled `docsxai manifest` next to the pages it publishes, under the same parent page or in the same database. Its body is a note and code blocks holding compact JSON (`docsxai/notion-manifest@1`): per section the page id, the sha256 of what was written and the page URL. The hash covers the title, the parent and the blocks, with each image standing in as the sha256 of its bytes, so it does not depend on upload ids. On push:

- the manifest page is found (the children of the parent page, or one database query on the title property, or `manifest_page_id`) and read;
- a page whose hash equals the manifest entry is skipped, so an unchanged pack performs zero writes;
- a changed page is rewritten in place, a new one is created;
- the manifest page is rewritten last, and only when something was written.

A page whose rewrite did not finish is recorded with an empty hash, so a push that fails midway redoes exactly that page, whatever the content hash says. A manifest page that does not parse as a docsxai manifest stops the push with an error, so a hand-edited state page never makes the plugin start over and duplicate every page. A single damaged entry is repaired and logged (at most 20 named, the rest counted): a page entry keeps its page id and costs one rewrite.

The manifest page is visible next to the pages. Deleting it makes the next push create every page again, and a push that dies after creating the pages and before the manifest write leaves pages the next push cannot find. A page deleted by hand in Notion is not noticed until its content changes or `force: true` is set.

## Layout

For `single` mode: one page with all flows and the images. For `page-tree` mode: a page for the overview and one per flow, all siblings under the same parent (Notion pages the plugin creates are not nested under the overview page). The result's `pages[]` entries carry `section`, `id` (the page id), `url` (the page's Notion URL) and `action` (`created`, `updated`, `unchanged`). Pages the plugin created earlier and the projection no longer contains are left in place.

## Rate limits

Notion allows about 3 requests a second per connection. The client spaces requests 350 ms apart, and answers a 429 by waiting for `Retry-After` seconds (or 1 s, doubling, when the header is missing), at most 30 s, then repeating the request, up to 5 retries. A 429 is a request Notion did not process, so repeating a write is safe. After the fifth retry the push fails with the masked response and can be re-run, and the manifest keeps what was already written.

## Hardening

- Redirects are an error on every request, so the token never follows a `Location` header.
- Every request has a timeout that also covers reading the response body: 30 s for API calls, 120 s for a file upload.
- JSON responses are capped at 8 MiB and error bodies at 64 KiB, whether or not Notion sends a `Content-Length`. A listing follows at most 20 pages of 100 children.
- Attachment paths must resolve inside the workspace. The read refuses a symlink in the last component, a FIFO or any non-regular file, caps the bytes actually read at 64 MiB, and hashes the bytes it read, not the `sha256` the projection claims.
- File names are reduced to `[A-Za-z0-9._-]`, and an all-dot name (`.`, `..`) is an error.
- A page is rewritten only when Notion reports it directly under the configured parent, not in the trash, and not the manifest page. A manifest entry that points anywhere else (the manifest page is editable by anyone with edit rights on it) is logged, ignored, and a new page is created. The foreign page is never written.
- Everything read from the manifest page is validated: ids, hashes and URLs (page URLs must be https on `www.notion.so` or `notion.so`). A `__proto__` key lands in a prototype-less map.

## API uncertainty

Checked against the Notion developer docs, not against a live workspace. A first live run should confirm these:

- Whether a file upload id can be used by more than one block. The plugin never reuses one: every page write uploads its images again.
- That the `Name` default title property and the `title` property key behave as documented for a database parent and a page parent.
- That the code blocks of the manifest page come back with their text unchanged (the reader concatenates their `plain_text`).
- Whether a deleted block that Notion has not yet dropped from a listing can make `clearChildren` re-delete it. The plugin remembers the ids it deleted and does not repeat them.
- Whether a page created under a parent page shows up in that page's child listing immediately. A push right after the first one that missed the manifest page would create a second one. Setting `manifest_page_id` removes the lookup.
- Databases with several data sources, and `Notion-Version` values from `2025-09-03` on, are not supported.

## Tests

`pnpm test` (after `pnpm -r build`, because the runtime-load test resolves the built package through the engine's real `resolvePlugins`). The suite runs an in-process fake Notion server on loopback, with no real network and no credentials. It asserts: a second push of the same pack performs zero writes; a changed page is rewritten in place with its writes counted; images arrive byte for byte through the upload API and are attached as image blocks; a screenshot over 20 MiB becomes a note; the token never appears in logs, errors, results or stored pages; the capability declaration is exactly `["egress:api.notion.com"]`; the base URL allowlist; redirects on writes are refused; a 429 is retried with its `Retry-After`, capped and bounded; responses over the cap are refused; attachment reads stay in the workspace; and a stalled upload leaves a marker the next push finishes.

## License

[Apache-2.0](../../LICENSE).
