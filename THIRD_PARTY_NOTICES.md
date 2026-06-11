# Third-party notices

docsxai's runtime dependencies (production-only):

## `@kalebtec/docsxai-engine`

- `fflate` — MIT
- `playwright-core` — Apache-2.0
- `yaml` — ISC
- `zod` — MIT

## `@kalebtec/docsxai-backend`

No production dependencies today (in-memory stub). Will gain HTTP server

- auth dependencies when the hosted deployment lands; those will
  be listed here at that time.

## `@kalebtec/docsxai-plugin`, `@kalebtec/docsxai-viewer`, `@kalebtec/docsxai-skill`

No production dependencies. The plugin shells out to the engine binary;
the viewer emits static HTML; the skill delegates to the installed
plugin.

---

This file is regenerated on every production-dependency change.
Generation runs as part of CI; manual: `pnpm licenses:notices` once the
script lands as part of the tooling baseline. Full license texts
for each dependency are bundled in the published npm packages under
each package's own `node_modules/<name>/LICENSE`.

A complete generated `THIRD_PARTY_NOTICES.md` with verbatim license
texts will replace this stub before v1.0.0 cuts.
