# Third-party notices

docsxai's runtime dependencies (production-only):

## `@kalebtec/docsxai-engine`

- `fflate` — MIT
- `playwright-core` — Apache-2.0
- `pngjs` — MIT
- `yaml` — ISC
- `zod` — MIT

## `@kalebtec/docsxai-viewer`

- `@resvg/resvg-js` — MPL-2.0
- `micromark` — MIT
- `satori` — MPL-2.0

Vendored asset: Inter Regular (`assets/fonts/inter-regular.ttf`) — SIL Open
Font License 1.1, license text colocated at `assets/fonts/LICENSE.txt`.

## `@kalebtec/docsxai-backend`

No production dependencies (node built-ins only: HTTP server, crypto,
filesystem persistence).

## `@kalebtec/docsxai-plugin`, `@kalebtec/docsxai-skill`

No production dependencies. The plugin shells out to the engine binary;
the skill delegates to the installed plugin.

---

This file is regenerated on every production-dependency change.
Generation runs as part of CI; manual: `pnpm licenses:notices` once the
script lands as part of the tooling baseline. Full license texts
for each dependency are bundled in the published npm packages under
each package's own `node_modules/<name>/LICENSE`.

A complete generated `THIRD_PARTY_NOTICES.md` with verbatim license
texts will replace this stub before v1.0.0 cuts.
