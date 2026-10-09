# Static accessibility and UX checks

Two CI steps lint built HTML for accessibility and UX regressions. Neither starts a browser. Both run one module, `packages/viewer/src/a11y-lint.ts` (`lintHtml`), which scans the markup with a small tolerant tag parser and takes no dependency. The module is not exported from `@docsxai/viewer`.

| Where                                    | What it lints                                                                                                           | When                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/viewer/test/a11y-lint.test.ts` | Pages rendered by `buildViewer` from a sample pack (index, two flows, an empty pack), plus one failing fixture per rule | `pnpm test`                                         |
| `website/scripts/check-a11y-surface.mjs` | `dist/` of the docs site: home, 404, `getting-started/quickstart`, `reference/flow-file` (a page with wide tables)      | last step of `pnpm --filter @docsxai/website build` |

The website script imports the TypeScript module directly (Node strips the types), so both surfaces share one rule set. Pass more pages as arguments (paths relative to `dist/`); it reads at most 40.

## Rules

A finding reads `<rule> <element>: <message>`.

| Rule                         | Fails when                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html-lang`                  | `<html>` is missing or has an empty `lang`.                                                                                                                    |
| `one-h1`                     | The page has no `<h1>` or more than one.                                                                                                                       |
| `heading-order`              | Inside `<main>`, a heading skips a level going down, or the first one is not `<h1>`. Headings in a nav, aside, header, footer or dialog are left out.          |
| `img-alt`                    | An `<img>` has no `alt` attribute (`alt=""` is fine).                                                                                                          |
| `form-label`                 | An `input` (not hidden, submit, button, reset, image), `select` or `textarea` has no `<label>`, `aria-label`, resolvable `aria-labelledby` or `title`.         |
| `landmarks`                  | There is not exactly one `main`, or no banner, navigation or contentinfo landmark.                                                                             |
| `skip-link`                  | No `#fragment` link with "skip" in its text, or its target id is not on the page.                                                                              |
| `tabindex-positive`          | Any `tabindex` above 0.                                                                                                                                        |
| `empty-link`, `empty-button` | An `<a href>` or button has no text, `alt`, `aria-label`, `aria-labelledby` or `title`. `aria-hidden` and `hidden` subtrees do not count as text.              |
| `aria-valid`                 | An `aria-*` attribute is not in the WAI-ARIA 1.2 list (deprecated `aria-grabbed` and `aria-dropeffect` fail), or a `role` token is not in the fixed role list. |
| `scroll-region-name`         | A non-native element with `tabindex` 0 or more that has `role="region"` or a class containing `scroll` has no `aria-label` or `aria-labelledby`.               |
| `reduced-motion`             | The inline and linked CSS has no `@media (prefers-reduced-motion: reduce)` block.                                                                              |
| `scrollbar-hidden`           | `scrollbar-width: none`, or `display: none` on `::-webkit-scrollbar`.                                                                                          |

## Limits

- It reads markup, so it cannot see what script adds later. `Footer.astro` makes a table wrapper focusable and labelled only while it overflows, and no static page has that state.
- `scrollbar-hidden` skips `@layer starlight.*` blocks in the site check. Starlight sets `scrollbar-width: none` on its table-of-contents rail inside that layer, and `brand.css` overrides it with unlayered rules.
- Contrast, focus order, target size and screen-reader output still need a browser. See the checks listed in `viewer-audit.md` and `docs-site-audit.md`.
