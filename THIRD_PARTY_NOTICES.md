# Third-party notices

docsxai's runtime dependencies (production-only):

## `@docsxai/engine`

- `fflate`: MIT
- `playwright-core`: Apache-2.0
- `pngjs`: MIT
- `yaml`: ISC
- `zod`: MIT

## `@docsxai/viewer`

- `@resvg/resvg-js`: MPL-2.0
- `micromark`: MIT
- `satori`: MPL-2.0

Vendored fonts in `packages/viewer/assets/fonts/`, all SIL Open Font License
1.1 with no Reserved Font Name:

| File                               | Font                         | Version | Size (bytes) | License text       |
| ---------------------------------- | ---------------------------- | ------- | ------------ | ------------------ |
| `inter-regular.ttf`                | Inter Regular                | 4.1     | 411,640      | `LICENSE.txt`      |
| `noto-sans-arabic-regular.ttf`     | Noto Sans Arabic Regular     | 2.013   | 67,496       | `LICENSE-noto.txt` |
| `noto-sans-hebrew-regular.ttf`     | Noto Sans Hebrew Regular     | 3.001   | 14,036       | `LICENSE-noto.txt` |
| `noto-sans-thai-regular.ttf`       | Noto Sans Thai Regular       | 2.002   | 17,740       | `LICENSE-noto.txt` |
| `noto-sans-devanagari-regular.ttf` | Noto Sans Devanagari Regular | 2.007   | 160,128      | `LICENSE-noto.txt` |

The Noto files are the unhinted builds from
[notofonts.github.io](https://github.com/notofonts/notofonts.github.io),
subsetted with fontTools `pyftsubset` to their script's Unicode blocks plus
space, the bidi and joiner controls and U+25CC, with every OpenType layout
feature kept. Names and copyright notices are unchanged.

## `@docsxai/backend`

No production dependencies (node built-ins only: HTTP server, crypto,
filesystem persistence).

## `@docsxai/plugin`, `@docsxai/skill`

No production dependencies. The plugin shells out to the engine binary;
the skill delegates to the installed plugin.

## `@docsxai/mcp` (repo-only; not published at v1.0)

- `@modelcontextprotocol/sdk`: MIT
- `zod`: MIT

The SDK's transitive production dependencies are predominantly MIT
(`express`, `cors`, `ajv`, `ajv-formats`, `content-type`, `cross-spawn`,
`eventsource`, `eventsource-parser`, `express-rate-limit`, `hono`,
`@hono/node-server`, `jose`, `pkce-challenge`, `raw-body`), plus
`zod-to-json-schema` (ISC) and `json-schema-typed` (BSD-2-Clause).

## `@docsxai/plugin-confluence`, `@docsxai/plugin-gitbook`, `@docsxai/plugin-guru`, `@docsxai/plugin-notion`, `@docsxai/plugin-sharepoint`, `@docsxai/plugin-starlight` (repo-only; not published at v1.0)

No third-party production dependencies (workspace packages only:
the engine, and for the Starlight plugin also the viewer).

---

This file is maintained by hand: any change to a package's production
dependencies must update it in the same diff (the docs-impact pass enforced
by `AGENTS.md`). There is no generator script today. To review the live
license set against this file, run
`pnpm exec license-checker-rseidelsohn --production --summary` from the
package's directory. The MPL-2.0 viewer dependencies are deliberate,
reviewed inclusions (file-level copyleft; unmodified use). Full license
texts for each dependency are bundled in the published npm packages under
each package's own `node_modules/<name>/LICENSE`.

A complete generated `THIRD_PARTY_NOTICES.md` with verbatim license
texts will replace this stub before v1.0.0 cuts.
