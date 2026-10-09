// Post-build static accessibility and UX check over a few built pages: html lang, one h1, heading
// order, image alt, form labels, landmarks, a skip link that lands, no positive tabindex, no empty
// links or buttons, valid aria-* names and roles, labelled focusable scroll regions, a
// prefers-reduced-motion block, and no hidden scrollbars. No browser: the rules are the viewer's
// a11y-lint module (packages/viewer/src/a11y-lint.ts), the same one its tests run over rendered
// viewer pages. Node strips the types when it imports the .ts file.
// Runs after `astro build`, against dist/. Extra pages (paths relative to dist/) can be passed as
// arguments. At most 40 pages are read.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFinding, lintHtml, linkedStylesheets } from "../../packages/viewer/src/a11y-lint.ts";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(site, "dist");
const MAX_PAGES = 40;
// Home (splash), the 404, a hand-written docs page and a page with wide tables.
const PINNED = [
  "index.html",
  "404.html",
  "getting-started/quickstart/index.html",
  "reference/flow-file/index.html",
];
// Starlight's component CSS sits in `@layer starlight.*`, which any unlayered site rule overrides
// (brand.css sets the thin scrollbars that way), so its own `scrollbar-width: none` is not judged.
const FRAMEWORK_LAYERS = ["starlight"];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const problems = [];
const listed = new Set();
for (const f of walk(dist)) if (f.endsWith(".html")) listed.add(relative(dist, f));

const pages = [...PINNED, ...process.argv.slice(2)].slice(0, MAX_PAGES);
const sheets = new Map();

function stylesheet(page, href) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const path = href.replace(/[?#].*$/, "");
  const file = path.startsWith("/") ? join(dist, path) : resolve(dirname(join(dist, page)), path);
  if (!sheets.has(file)) sheets.set(file, existsSync(file) ? readFileSync(file, "utf8") : null);
  return sheets.get(file);
}

for (const page of pages) {
  if (!listed.has(page)) {
    problems.push(`${page}: not in dist/ (${listed.size} HTML pages built)`);
    continue;
  }
  const html = readFileSync(join(dist, page), "utf8");
  const css = [];
  for (const href of linkedStylesheets(html)) {
    const text = stylesheet(page, href);
    if (text !== null) css.push(text);
  }
  for (const f of lintHtml(html, { css, skipLayers: FRAMEWORK_LAYERS })) {
    problems.push(`${page}: ${formatFinding(f)}`);
  }
}

if (problems.length > 0) {
  console.error(
    `check-a11y-surface: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(
  `check-a11y-surface: ok (${pages.length} pages, ${sheets.size} stylesheet files checked).`,
);
