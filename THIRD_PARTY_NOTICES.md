# Third-party notices

docsxai's runtime dependencies (production-only):

## `@docsxai/engine`

- `fflate` — MIT
- `playwright-core` — Apache-2.0
- `pngjs` — MIT
- `yaml` — ISC
- `zod` — MIT

## `@docsxai/viewer`

- `@resvg/resvg-js` — MPL-2.0
- `micromark` — MIT
- `satori` — MPL-2.0

Vendored asset: Inter Regular (`assets/fonts/inter-regular.ttf`) — SIL Open
Font License 1.1, license text colocated at `assets/fonts/LICENSE.txt`.

## `@docsxai/backend`

No production dependencies (node built-ins only: HTTP server, crypto,
filesystem persistence).

## `@docsxai/plugin`, `@docsxai/skill`

No production dependencies. The plugin shells out to the engine binary;
the skill delegates to the installed plugin.

## `@docsxai/mcp` (repo-only; not published at v1.0)

- `@modelcontextprotocol/sdk` — MIT
- `zod` — MIT

The SDK's transitive production dependencies are predominantly MIT
(`express`, `cors`, `ajv`, `ajv-formats`, `content-type`, `cross-spawn`,
`eventsource`, `eventsource-parser`, `express-rate-limit`, `hono`,
`@hono/node-server`, `jose`, `pkce-challenge`, `raw-body`), plus
`zod-to-json-schema` — ISC and `json-schema-typed` — BSD-2-Clause.

## `@docsxai/plugin-confluence`, `@docsxai/plugin-starlight` (repo-only; not published at v1.0)

No third-party production dependencies (workspace packages only:
the engine, and for the Starlight plugin also the viewer).

---

This file is maintained by hand: any change to a package's production
dependencies must update it in the same diff (the docs-impact pass enforced
by `AGENTS.md`). There is no generator script today — to review the live
license set against this file, run
`pnpm exec license-checker-rseidelsohn --production --summary` from the
package's directory. The MPL-2.0 viewer dependencies are deliberate,
reviewed inclusions (file-level copyleft; unmodified use). Full license
texts for each dependency are bundled in the published npm packages under
each package's own `node_modules/<name>/LICENSE`.

A complete generated `THIRD_PARTY_NOTICES.md` with verbatim license
texts will replace this stub before v1.0.0 cuts.
