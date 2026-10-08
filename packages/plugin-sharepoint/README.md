# @docsxai/plugin-sharepoint

docsxai **publisher plugin** for SharePoint Online. Registers `sharepoint:push`, which takes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`), renders each document to markdown and uploads it, with its screenshots, into a folder of a SharePoint document library through Microsoft Graph. A second push of unchanged content performs zero writes.

The engine emits projections only and performs no wiki egress. This plugin is the SharePoint egress path. Its manifest declares one capability per host the code can reach: `egress:graph.microsoft.com`, `egress:graph.microsoft.us`, `egress:microsoftgraph.chinacloudapi.cn` and `egress:graph.microsoft.de` (the API), and `egress:*.sharepoint.com`, `egress:*.sharepoint.us`, `egress:*.sharepoint.cn` and `egress:*.sharepoint.de` (the pre-authenticated download URL Graph redirects a file read to). The runtime loads a plugin only when every declared capability is enabled, so the workspace's `plugin_capabilities` has to list all eight, whichever cloud the tenant is in. All HTTP uses the built-in `fetch`.

> **Repo-only.** `@docsxai/plugin-sharepoint` is not published to npm (`private: true`). A new publishable package needs an npm trusted-publisher binding first, and that is not set up. Build it from a checkout (`pnpm -r build`) and wire it by path: `{ "path": "<checkout>/packages/plugin-sharepoint" }` (relative paths resolve from the workspace directory).

## Design decision: document library, not site pages

Graph offers two ways to publish. Site pages (`POST /sites/{id}/pages/microsoft.graph.sitePage`) need a canvas layout of web parts, images have to be uploaded to the site's asset library anyway and referenced by URL, and the page has to be published in a second call. The document library route is one call per file: `PUT /drives/{drive-id}/root:/{path}:/content` (simple upload, one request per file). This plugin takes the library route. It writes `.md` files and `.png` images, and the markdown links its images with relative paths (`images/<flow>--<step>.png`) so a folder reads the same in SharePoint, in a synced folder, or after a download.

The cost: these are files in a library, not modern site pages. They appear in the library view and open in the SharePoint markdown preview, but they do not show in site navigation or search results as pages. If a team needs real site pages, that is a second publisher on the same projection.

## Wiring

`.docsxai.json`:

```json
{
  "plugins": [{ "path": "<checkout>/packages/plugin-sharepoint" }],
  "plugin_capabilities": [
    "egress:graph.microsoft.com",
    "egress:graph.microsoft.us",
    "egress:microsoftgraph.chinacloudapi.cn",
    "egress:graph.microsoft.de",
    "egress:*.sharepoint.com",
    "egress:*.sharepoint.us",
    "egress:*.sharepoint.cn",
    "egress:*.sharepoint.de"
  ]
}
```

The token comes from the environment, never from config or the repo. The publisher reads the variable named in `secretsEnv.token` (default `SHAREPOINT_TOKEN`) and sends it as `Authorization: Bearer <token>`. The token needs `Sites.ReadWrite.All` or `Files.ReadWrite.All` on the library (or the narrower `Sites.Selected` with a write grant on the site). Obtaining and refreshing it is outside this plugin. The token is masked as `<SHAREPOINT_TOKEN>` in every error and log line, including when Graph echoes it back in an error body.

## Publish config

Passed as the publisher's `config`:

| Key              | Required   | Meaning                                                                                                                                                                                                                                                                                                    |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drive_id`       | one of two | Document library id (`drives/{id}`). Wins when both are set. `.`, `..` and any id with `/`, `\`, `?` or `#` are refused.                                                                                                                                                                                   |
| `site_id`        | one of two | Site id; the site's default document library (`sites/{id}/drive`) is used. Same character rules as `drive_id`.                                                                                                                                                                                             |
| `folder`         | no         | Folder inside the library, `docsxai` by default. The first upload into a missing folder relies on Graph creating the parent folders from the path; that is untested against a live tenant, so create the folder first if the first push fails.                                                             |
| `graph_base_url` | no         | Graph endpoint, `https://graph.microsoft.com/v1.0` by default. Must be `https` on a Microsoft Graph host (global, US, China and Germany clouds) with no port other than the default, no query or fragment, and the path `/v1.0` or `/beta`; plain http on loopback only under the publisher's test option. |
| `title_prefix`   | no         | Prepended to every page title, e.g. `"[Docs] "`.                                                                                                                                                                                                                                                           |
| `force`          | no         | `true` uploads every file even when the manifest says it is unchanged.                                                                                                                                                                                                                                     |

`graph_base_url` is checked against an allowlist of Graph hosts before any request, so the bearer token is only sent to one of them. Capabilities gate which plugins load and are matched as exact strings; the manifest declares every host in that allowlist and every SharePoint download domain, so the capability list matches what the code can reach.

Graph answers a file read (`GET .../root:/<path>:/content`) with a redirect to a pre-authenticated download URL. A read follows exactly one hop, only when the `Location` is `https` on a subdomain of `sharepoint.com` (or the `.us`, `.cn` and `.de` domains), with no credentials and the default port, and it sends no `Authorization` header there. A second redirect, or a `Location` anywhere else, fails the read. Writes never follow a redirect. Every call has a deadline that covers the response body: 30 seconds for API calls, 120 seconds for uploads.

## Layout

For `single` mode: `<folder>/index.md` and `<folder>/images/*.png`. For `page-tree` mode: `index.md` (the overview), one `<flow>.md` per flow, and `images/`. Image names are `<flow>--<step>.png`. A fixed `docsxai-manifest.json` sits next to the pages. Page and image names are compared case-insensitively after they are folded to `[A-Za-z0-9._-]`; two sections that land on one path (`a b` and `a-b`, `Login` and `login`, a flow named `index` next to the overview) or two different screenshots that share an image name fail the push before any request, with both names in the message. Files the plugin wrote earlier and the projection no longer contains are left in place.

The result's `pages[]` entries carry `section`, `id` (the driveItem id), `url` (the item's `webUrl`) and `action` (`created`, `updated`, `unchanged`). Page identity is the path, so there is no page map to persist.

## Idempotency

`docsxai-manifest.json` (`docsxai/sharepoint-manifest@1`) records the sha256, size, id and `webUrl` of every file the plugin wrote. On push:

- the manifest is read once (one GET; absent means first push);
- a file whose local sha256 equals the manifest entry is skipped, so an unchanged pack performs zero writes;
- a changed file is uploaded with `conflictBehavior=replace`, images first and the page second;
- the manifest is written last, and only when something was uploaded, so a push that fails midway redoes the missing files on the next run.

Document content is rendered as inert markdown: text, code spans, alt text and titles are escaped (a code span uses a backtick run longer than any inside it, a code fence likewise), titles and `title_prefix` lose newlines and control characters, links are kept only for `http`, `https` and `mailto` with parentheses, whitespace and brackets in the target percent-encoded, and heading levels are clamped to 1 to 6.

A page reports `updated` when its markdown or any of its images was uploaded. The manifest is the source of truth: a file deleted by hand in SharePoint is not noticed until its content changes or `force: true` is set.

## Caveats

- Every file goes up as one simple upload (`PUT .../content`); there is no resumable upload session. The plugin does not check Graph's simple-upload size limit, so a screenshot over it fails with Graph's masked response. Screenshots are capped at 64 MiB on read.
- There is no retry on Graph throttling (HTTP 429). A throttled push fails with the masked response and can be re-run; the manifest keeps the files already uploaded.
- No live tenant run has happened. Two things are assumptions about Graph that the in-process fake server models and nothing has confirmed: that a file read answers with a redirect to a pre-authenticated download URL, and that an upload creates missing parent folders.
- The plugin is in-process and unsandboxed, like every docsxai plugin. `trust: "kalebtec"` is a review signal.

## Tests

`pnpm test` (after `pnpm -r build`, because the runtime-load test resolves the built package through the engine's real `resolvePlugins`). The suite runs an in-process fake Graph server on loopback, with no real network and no credentials. It asserts: a second push of the same pack performs zero writes; a prose change rewrites one page and the manifest; a changed screenshot re-uploads that image only; images arrive byte for byte; the token never appears in logs, errors or results (an error body is masked before it is cut); a manifest read follows one redirect to a download URL without the bearer token, and a redirect to another host, to plain http, to a URL with credentials or a port, or a second redirect, is refused; a stalled call, upload or response body ends in a timeout; colliding section and image names fail before any request; code spans, links, titles, alt text and heading levels are neutralised; and the capability declaration is exactly `["egress:graph.microsoft.com", "egress:*.sharepoint.com"]`.

## License

[Apache-2.0](../../LICENSE).
