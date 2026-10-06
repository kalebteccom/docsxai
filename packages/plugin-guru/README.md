# @docsxai/plugin-guru

docsxai **publisher plugin** for Guru. Registers `guru:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`), renders each document to HTML and creates or updates one card per document in a Guru collection, with its screenshots uploaded as Guru-hosted attachments and embedded in the card. A second push of unchanged content performs zero writes.

The engine emits projections only and performs no wiki egress. This plugin is the Guru egress path. Its manifest declares exactly one capability, `egress:api.getguru.com`, which the workspace's `plugin_capabilities` has to opt into. All HTTP uses the built-in `fetch`.

> **Repo-only.** `@docsxai/plugin-guru` is not published to npm (`private: true`). A new publishable package needs an npm trusted-publisher binding first, and that is not set up. Build it from a checkout (`pnpm -r build`) and wire it by path: `{ "path": "<checkout>/packages/plugin-guru" }` (relative paths resolve from the workspace directory).

## Wiring

`.docsxai.json`:

```json
{
  "plugins": [{ "path": "<checkout>/packages/plugin-guru" }],
  "plugin_capabilities": ["egress:api.getguru.com"]
}
```

Credentials come from the environment, never from config or the repo. The publisher reads the variables named in `secretsEnv.email` (default `GURU_USER_EMAIL`) and `secretsEnv.token` (default `GURU_USER_TOKEN`) and sends them as HTTP Basic auth, `Authorization: Basic base64(email:token)`. That is the scheme Guru documents for a **user token**: read and write, acting as the user who owns it, so the user needs author rights on the target collection. A **collection token** is read-only and cannot push. Both values and the encoded header are masked as `<GURU_USER_EMAIL>`, `<GURU_USER_TOKEN>` and `<GURU_BASIC_AUTH>` in every error and log line, including when Guru echoes them back in an error body.

## Publish config

Passed as the publisher's `config`:

| Key                | Required | Meaning                                                                                                                        |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `collection_id`    | yes      | Id of the Guru collection the cards go into.                                                                                   |
| `base_url`         | no       | `https://api.getguru.com/api/v1`, the only value accepted. See the allowlist below.                                            |
| `title_prefix`     | no       | Prepended to every card title, e.g. `"[Docs] "`.                                                                               |
| `share_status`     | no       | `TEAM` (default) or `PRIVATE`. `TEAM` shows the cards to the collection's members.                                             |
| `force`            | no       | `true` writes every card and image even when the manifest says it is unchanged.                                                |
| `manifest_card_id` | no       | Id of the manifest card. The plugin logs it after the first push, and passing it back skips the search that finds it by title. |

`base_url` is pinned: `https` on `api.getguru.com`, default port, path `/api/v1`, no credentials, query or fragment. Anything else fails before the first request, so the credentials cannot be sent to another host through config. Plain `http` on a loopback host is accepted only through a constructor option of `createGuruPublisher` that tests use against the fake server. Config cannot set it. Capabilities gate which plugins load and are a review signal, not a network sandbox.

## Design decisions

**Card content as HTML.** `POST /cards/extended` documents `content` as "the Card's HTML or Markdown content". The plugin sends HTML. The ADF renderer escapes every text and attribute value, keeps a link only when it is http, https or mailto, and writes `<img src>` for screenshots, so the result does not depend on how Guru detects markdown.

**Create, then update in place.** A new document is `POST /cards/extended` with `preferredPhrase` (the title), `content`, `shareStatus` and `collection: { id }`. A changed document is `PUT /cards/{id}/extended` with the same body. Guru's update drops every tag when `tags` is missing, so the plugin reads the card first (`GET /cards/{id}/extended`) and sends its existing `tags` back unchanged. If that read returns 404 (the card was deleted in Guru), the plugin creates a new card. A card is updated only when its read names the target collection. If Guru returns a card without its `collection` field, the plugin cannot verify it, so it creates a new card instead and logs one warning per push saying so; every push then creates new cards until the read includes the collection. The manifest card has no such fallback: a manifest read without the collection fails the push.

**Images as Guru-hosted attachments.** Each screenshot goes through `POST /attachments/upload` (multipart, field `file`). The response carries a `link` on `https://content.api.getguru.com/files/view/...`, which the card embeds. The plugin accepts only a link on that host, with no credentials, port or query, and never fetches it, so egress stays on `api.getguru.com`.

**Idempotency through a manifest card.** The Guru public API documents no field for arbitrary data on a card, and a tag needs a tag category and an id before a card can carry it. So the plugin keeps one card titled `docsxai manifest` in the target collection. Its body is a `<pre>` block with compact JSON (`docsxai/guru-manifest@1`): per section the card id, the sha256 of the rendered card and its URL, and per image the sha256, size and hosted URL. The card hash covers the title, share status, collection and final HTML (image URLs included). On push:

- the manifest card is found (one `GET /search/query`, or one `GET /cards/{id}/extended` when `manifest_card_id` is set) and read;
- an image whose bytes hash like the manifest entry keeps its hosted URL and is not uploaded again;
- a card whose hash equals the manifest entry is skipped, so an unchanged pack performs zero writes;
- a changed card is updated in place, a new one is created;
- the manifest card is written last, and only when something was written, so a push that fails midway redoes the missing parts.

A manifest card that does not parse as a docsxai manifest stops the push with an error, so a hand-edited state card never makes the plugin start over and duplicate every card. A single damaged entry is repaired and logged (at most 20 named, the rest counted): a page entry keeps its card id and costs one update, an image entry costs one upload.

The manifest card is visible in the collection. Deleting it makes the next push create every card again. A card deleted by hand in Guru is not noticed until its content changes or `force: true` is set.

## Layout

For `single` mode: one card with all flows and the images. For `page-tree` mode: a card for the overview and one per flow. The result's `pages[]` entries carry `section`, `id` (the card id), `url` (`https://app.getguru.com/card/<slug>`, when Guru returned a usable `slug`) and `action` (`created`, `updated`, `unchanged`). Cards the plugin created earlier and the projection no longer contains are left in place.

## Hardening

- Redirects are an error on every request, so credentials never follow a `Location` header.
- Every request has a timeout that also covers reading the response body: 30 s for API calls, 120 s for an attachment upload. The manifest write after the card loop is bounded the same way, and when it fails after another error, that first error is the one the push reports and the manifest failure is logged. A push that hit no other error fails on a manifest write that times out.
- JSON responses are capped at 8 MiB and error bodies at 64 KiB, whether or not Guru sends a `Content-Length`. Search follows at most 5 pages, and only links on the validated origin and API path.
- Attachment paths must resolve inside the workspace. The read refuses a symlink in the last component, a FIFO or any non-regular file, caps the bytes actually read at 64 MiB, and hashes the bytes it read, not the `sha256` the projection claims.
- File names are reduced to `[A-Za-z0-9._-]`, and an all-dot name (`.`, `..`) is an error.
- A card is updated only when Guru reports it in `collection_id` and it is not the manifest card. A manifest entry that points anywhere else (the manifest is editable by anyone with edit rights on that card) is logged, ignored, and a new card is created. The foreign card is never written.
- Everything read from the manifest card is validated: ids, hashes, sizes, and URLs (card URLs must be https on `app.getguru.com`, image URLs exactly `https://content.api.getguru.com/files/view/<id>` with one id segment of `[A-Za-z0-9_-]`, no query, port or userinfo). A `__proto__` key lands in a prototype-less map.

## API uncertainty

Checked against the Guru developer docs, not against a live Guru account. A first live run should confirm these:

- `POST /attachments/upload` is documented in Guru's community answers, not in the developer reference. Its response is taken to be `{ link, attachmentId, filename, mimeType, size }`.
- Whether Guru keeps `<img>` tags that point at an uploaded `link` unchanged on save (the plugin assumes it does).
- Whether Guru rewrites the manifest card's `<pre>` block on save. The reader strips tags and decodes entities, but a transformation beyond that stops the push with "not a docsxai manifest".
- Card search (`GET /search/query?searchTerms=...`) is eventually consistent in the plugin's assumption. A push right after the first one can miss the manifest card and create a second one. Setting `manifest_card_id` removes the search.
- The `Link` header's `rel` for the next search page is not documented. The reader accepts any `rel` containing `next`.
- The web URL shape `https://app.getguru.com/card/<slug>`. The field `slug` is documented, the URL built from it is not.
- Passing `collection: { id }` on update. The docs mark only `content` and `preferredPhrase` as required there.
- Rate limits are not documented, and 30 s and 120 s are the plugin's own limits. There is no retry: a throttled push fails with the masked response and can be re-run, and the manifest keeps what was already written.

## Tests

`pnpm test` (after `pnpm -r build`, because the runtime-load test resolves the built package through the engine's real `resolvePlugins`). The suite runs an in-process fake Guru server on loopback, with no real network and no credentials. It asserts: a second push of the same pack performs zero writes; a changed card is updated in place with one write plus the manifest; images arrive byte for byte and are embedded by hosted URL; tags survive an update; the token, email and encoded header never appear in logs, errors, results or stored cards; the capability declaration is exactly `["egress:api.getguru.com"]`; the base URL allowlist; redirects on writes are refused; responses over the cap are refused; and attachment reads stay in the workspace.

## License

[Apache-2.0](../../LICENSE).
