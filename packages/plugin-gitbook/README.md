# @docsxai/plugin-gitbook

docsxai **publisher plugin** for GitBook. Registers `gitbook:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`), renders each document to markdown and publishes one page per document in a GitBook space, with its screenshots sent as GitBook files and shown inline. A second push of unchanged content performs zero writes and opens no change request.

The engine emits projections only and performs no wiki egress. This plugin is the GitBook egress path. Its manifest declares exactly one capability, `egress:api.gitbook.com`, which the workspace's `plugin_capabilities` has to opt into. All HTTP uses the built-in `fetch`.

> **Repo-only.** `@docsxai/plugin-gitbook` is not published to npm (`private: true`). A new publishable package needs an npm trusted-publisher binding first, and that is not set up. Build it from a checkout (`pnpm -r build`) and wire it by path: `{ "path": "<checkout>/packages/plugin-gitbook" }` (relative paths resolve from the workspace directory).

## Wiring

`.docsxai.json`:

```json
{
  "plugins": [{ "path": "<checkout>/packages/plugin-gitbook" }],
  "plugin_capabilities": ["egress:api.gitbook.com"]
}
```

The token comes from the environment, never from config or the repo. The publisher reads the variable named in `secretsEnv.token` (default `GITBOOK_TOKEN`) and sends it as `Authorization: Bearer <token>`. Use a GitBook API token (personal access token) of a user who can edit and merge in the target space. The token is masked as `<GITBOOK_TOKEN>` in every error and log line, including when GitBook echoes it back in an error body.

## Publish config

Passed as the publisher's `config`:

| Key                | Required | Meaning                                                                                  |
| ------------------ | -------- | ---------------------------------------------------------------------------------------- |
| `space_id`         | yes      | Id of the GitBook space the pages go into.                                               |
| `base_url`         | no       | `https://api.gitbook.com/v1`, the only value accepted. See the allowlist below.          |
| `parent_page_id`   | no       | Page the new pages are created under. Without it they sit at the top level of the space. |
| `title_prefix`     | no       | Prepended to every page title, e.g. `"[Docs] "`.                                         |
| `force`            | no       | `true` writes every page and screenshot even when the manifest says it is unchanged.     |
| `manifest_page_id` | no       | Id of the manifest page. Picks one when two pages carry the manifest title.              |

`base_url` is pinned: `https` on `api.gitbook.com`, default port, path `/v1`, no credentials, query or fragment. Anything else fails before the first request, so the token cannot be sent to another host through config. Plain `http` on a loopback host is accepted only through a constructor option of `createGitBookPublisher` that tests use against the fake server. Config cannot set it. Capabilities gate which plugins load and are a review signal, not a network sandbox.

## Design decisions

**The write route: a change request, then merge.** GitBook edits content through change requests (a draft copy of the space, like a branch). The plugin opens one (`POST /spaces/{id}/change-requests`), applies the page and screenshot changes to it with the batch endpoint (`POST /spaces/{id}/change-requests/{id}/content`, `insert_files`, `insert_page` and `update_page` changes, markdown documents), and merges it (`POST .../merge`). Two other routes exist. Git Sync needs a Git repository connected to the space and a push to it, which a GitBook API token cannot do. The organisation import (`POST /org/{id}/imports`, "Import content into a space from a website") reads a web source and offers AI enhancement, so it cannot carry markdown bytes. The batch endpoint is the one GitBook describes as the primary way to author content through the API. Each batch is atomic: one invalid change rejects the whole batch.

**One change request per push, opened only when something changed.** The plugin lists the space's pages and reads the manifest first. When every page's hash matches and the page still exists, it stops: no change request is opened and no write is made. Otherwise it applies one batch per changed page (the page's screenshots and the page itself), then one batch for the manifest page, then merges. A push that fails before the merge archives its change request (`PATCH` status `archived`), so nothing half-written goes live and the manifest never describes work that did not land. When the archive call fails too, the first error is the one the push reports.

**Markdown with the title in frontmatter.** Each document is rendered from the ADF projection with the same subset the engine reads (paragraphs, headings, lists, code, bold, emphasis, links). The title goes in YAML frontmatter and in the `title` field of the change. GitBook documents that frontmatter and a leading heading win over the `title` field, so there is one source. Text is escaped so GitBook syntax (`{% %}` tags, tables, HTML) cannot enter through step copy, links are kept only when http, https or mailto, and code is fenced with more backticks than it contains.

**Images as inline files.** `insert_files` takes inline bytes (`base64`, at most 1 MB) or a public `url` that GitBook fetches. The plugin sends bytes only, so it never needs a public URL for a screenshot and egress stays on `api.gitbook.com`. A page refers to a file in the same batch as `![alt](./<ref>)`, and GitBook resolves the reference to the file id when it applies the batch. A screenshot over 700,000 bytes (about 933,000 base64 characters, under the limit whichever way GitBook counts the megabyte) is left out: the push names it in the result's `warnings` and the page shows the caption `Screenshot not uploaded: <name>`. At most 16 MiB of screenshots go with one page, the rest are left out the same way. The larger uploads GitBook supports go through `POST /orgs/{id}/storage/upload`, a signed URL on a storage host, which would need a second egress host. That route is not used.

**Idempotency through a manifest page.** GitBook pages carry no field for arbitrary data (`description` is public SEO text). So the plugin keeps one page titled `docsxai manifest` next to the pages it publishes. It is created `hidden`, `noIndex` and `noRobotsIndex`, so it is out of the navigation and search. A hidden page is still reachable by URL in a public space. Its body is a fenced `json` block (`docsxai/gitbook-manifest@1`) with, per section, the page id and the sha256 of what the plugin sent: the title, slug, parent, rendered markdown and the sha256 of every screenshot read. The manifest page is written in the same change request as the pages, so one merge lands both. Pages are found by id, so a renamed page keeps its identity. A page deleted in GitBook is noticed on the next push (the id is not in the space's page list) and created again, with a warning.

The manifest page is visible in the space's page tree. Deleting it makes the next push create every page again. A manifest page that does not parse as a docsxai manifest stops the push with an error, so a hand-edited state page never makes the plugin start over and duplicate every page. A single damaged entry is repaired and logged (at most 20 named, the rest counted): its page id is kept, so it costs one update.

## Layout

For `single` mode: one page with all flows and the images. For `page-tree` mode: a page for the overview and one per flow, all as siblings under `parent_page_id` (or the top level). The result's `pages[]` entries carry `section`, `id` (the page id), `url` (`urls.app` of the page, read from the page list after the merge, `https://app.gitbook.com/...` only) and `action` (`created`, `updated`, `unchanged`). Pages the plugin created earlier and the projection no longer contains are left in place. The slug of a page is its section name, lower-cased. It is set on creation and not changed by an update, so URLs stay stable.

## Hardening

- Redirects are an error on every request, so the token never follows a `Location` header.
- Every request has a timeout that also covers reading the response body: 30 s for API calls, 120 s for a content batch and a merge.
- JSON responses are capped at 8 MiB and error bodies at 64 KiB, whether or not GitBook sends a `Content-Length`. A page list is capped at 20,000 pages and 32 levels.
- Attachment paths must resolve inside the workspace. The read refuses a symlink in the last component, a FIFO or any non-regular file, caps the bytes actually read at 64 MiB, and hashes the bytes it read, not the `sha256` the projection claims.
- File names are reduced to `[A-Za-z0-9._-]`, and an all-dot name (`.`, `..`) is an error.
- A page is updated only when GitBook lists it directly under the target (`parent_page_id`, or the top level of the space) and it is not the manifest page. A manifest entry that points anywhere else (the manifest is editable by anyone with edit rights on that page) is logged, ignored, and a new page is created. The foreign page is never written. A page moved elsewhere in the tree is therefore not tracked: the plugin creates a new one.
- Everything read from the manifest page is validated: ids, hashes and keys. A `__proto__` key lands in a prototype-less map.
- Ids from config and from GitBook responses must match `[A-Za-z0-9_-]{1,128}` before they reach a URL or a request body.

## API uncertainty

Checked against GitBook's published OpenAPI document (`https://api.gitbook.com/openapi.json`) and developer docs, not against a live GitBook account. A first live run should confirm these:

- The batch endpoint documents `compat=true` as today's default, with `compat=false` returning the touched pages. The plugin always sends `compat=false` and reads `changes[]` (`created_page`, `updated_page`, each with `page.id`). If GitBook flips the default or drops the parameter, the page id of a new page is not found and the push fails with an error that names the section.
- Whether GitBook keeps the frontmatter `title` as the page title and strips the block from the stored body, and whether a leading heading in the body is treated as a second title.
- The `1 MB` cap on `insert_files` `base64`: counted on the encoded or the decoded bytes. The plugin stays under both readings. A screenshot that GitBook still refuses fails the push.
- Whether a re-sent screenshot with an existing file name makes a second file or replaces the first. The plugin sends a page's screenshots again whenever the page changes, so superseded files can pile up in the space.
- Whether `![alt](./<ref>)` resolves a reference that has no extension, and whether a ref can collide with an existing page path. Refs are `docsxai-img-<n>`.
- Whether the manifest page's fenced block survives GitBook's normalisation. The reader takes the first fenced block with any language tag and either line ending, but a transformation beyond that stops the push with "not a docsxai manifest".
- The page list (`GET /spaces/{id}/content/pages`) is assumed to be complete (no pagination), as the OpenAPI document shows no cursor. Group pages are read for their children, and only `document` pages are candidates.
- A merge that answers `conflicts` has still been applied. The plugin reports it as a warning. A push does not run `POST .../update` first to sync the change request with newer live content, so a push that races a human edit can conflict.
- Rate limits are not documented, and 30 s and 120 s are the plugin's own limits. There is no retry: a throttled push fails with the masked response, archives its change request and can be re-run.
- A custom domain or a site-level URL for a published page is not built. `url` is the `urls.app` link only.

## Tests

`pnpm test` (after `pnpm -r build`, because the runtime-load test resolves the built package through the engine's real `resolvePlugins`). The suite runs an in-process fake GitBook server on loopback, with no real network and no credentials. It asserts: a second push of the same pack performs zero writes and opens no change request; a changed page is updated in place with one change request; screenshots arrive byte for byte and are linked by file id; an oversized screenshot is named and left out; the token never appears in logs, errors, results or stored pages; the capability declaration is exactly `["egress:api.gitbook.com"]`; the base URL allowlist; redirects on writes are refused; responses over the cap are refused; a failed batch archives the change request and leaves the space as it was; and attachment reads stay in the workspace.

## License

[Apache-2.0](../../LICENSE).
