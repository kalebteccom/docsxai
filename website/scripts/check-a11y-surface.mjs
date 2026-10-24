// Post-build static accessibility and UX check over a few built pages: html lang, one h1, heading
// order, image alt, form labels, landmarks, a skip link that lands, no positive tabindex, no empty
// links or buttons, valid aria-* names and roles, labelled focusable scroll regions, a
// prefers-reduced-motion block, and no hidden scrollbars. No browser: the rules are the viewer's
// a11y-lint module (packages/viewer/src/a11y-lint.ts), the same one its tests run over rendered
// viewer pages. Node strips the types when it imports the .ts file.
// On top of those rules, `surfaceChecks` reads the built HTML for the onboarding path: a zoomable
// viewport, copy buttons that name themselves, announce their result and copy no prompt, tables
// inside a scroll wrapper, numbered quickstart steps, five first-run steps on the landing page, a
// "next" link on each onboarding page, a 404 that links to the quickstart and the installation
// page, and a search with a no-results message.
// Runs after `astro build`, against dist/. Extra pages (paths relative to dist/) can be passed as
// arguments. At most 40 pages are read.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFinding, lintHtml, linkedStylesheets } from "../../packages/viewer/src/a11y-lint.ts";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(site, "dist");
const MAX_PAGES = 40;
// Home (splash), the 404, the three onboarding pages, the CLI reference, a page with wide tables
// and the two burn guides.
const PINNED = [
  "index.html",
  "404.html",
  "getting-started/introduction/index.html",
  "getting-started/installation/index.html",
  "getting-started/quickstart/index.html",
  "reference/cli/index.html",
  "reference/flow-file/index.html",
  "guides/burn-theming/index.html",
  "guides/annotation-placement/index.html",
];
// Where each onboarding page sends the reader next (the rel="next" pagination link).
const NEXT_LINK = {
  "getting-started/introduction/index.html": "/getting-started/installation/",
  "getting-started/installation/index.html": "/getting-started/quickstart/",
  "getting-started/quickstart/index.html": "/reference/flow-file/",
};
// Pages that must hold copy buttons on their own install commands: the hero one-liner, two install
// cards and the five first-run steps.
const LANDING_COPY_BUTTONS = 8;
const LANDING_FIRST_RUN_STEPS = 5;
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

const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2] ?? "") : null;
};
/** True when a line of the copied text starts with a shell prompt. */
const hasPrompt = (text) => /(^|\n)\s*\$(\s|$)/.test(text);

/** Checks over the built HTML of one page that the lint rules do not cover. */
function surfaceChecks(page, html) {
  const out = [];
  const viewport = /<meta\b[^>]*name="viewport"[^>]*>/i.exec(html)?.[0] ?? "";
  if (!/width=device-width/i.test(viewport))
    out.push("viewport: no <meta name=viewport content=width=device-width>");
  if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport))
    out.push("viewport: zoom is disabled (user-scalable or maximum-scale)");

  // Hand-built copy buttons: a name, a live region, and text without a prompt.
  const buttons = [...html.matchAll(/<button\b[^>]*\sdata-copy=[^>]*>/g)].map((m) => m[0]);
  const regions = [...html.matchAll(/<[a-z]+\b[^>]*\sdata-copy-status[^>]*>/g)].map((m) => m[0]);
  if (page === "index.html" && buttons.length < LANDING_COPY_BUTTONS)
    out.push(
      `copy: ${buttons.length} copy buttons on the landing page, expected ${LANDING_COPY_BUTTONS}`,
    );
  if (page === "index.html") {
    const steps = (html.match(/<li\b[^>]*class="[^"]*\bdocsx-step\b/g) ?? []).length;
    if (steps !== LANDING_FIRST_RUN_STEPS)
      out.push(
        `first run: ${steps} steps on the landing page, expected ${LANDING_FIRST_RUN_STEPS}`,
      );
    const afterFirstRun = html.split('id="first-run"')[1] ?? "";
    if (!/<a\b[^>]*\shref="\/getting-started\/quickstart\/"/.test(afterFirstRun))
      out.push("first run: no link to the quickstart after the first-run section");
  }
  if (regions.length < buttons.length)
    out.push(`copy: ${buttons.length} copy buttons but ${regions.length} status regions`);
  for (const tag of buttons) {
    if (!(attrOf(tag, "aria-label") ?? "").trim())
      out.push("copy: a copy button has no aria-label");
    if (!/\stype="button"/.test(tag)) out.push('copy: a copy button is not type="button"');
    if (hasPrompt(attrOf(tag, "data-copy") ?? ""))
      out.push("copy: a copy button copies a `$` prompt");
  }
  for (const tag of regions) {
    if (!/\saria-live="polite"/.test(tag) || !/\srole="status"/.test(tag))
      out.push('copy: a status region lacks role="status" aria-live="polite"');
  }

  // Expressive Code copy buttons carry the code in data-code, with U+007F for a newline.
  for (const m of html.matchAll(/<button\b[^>]*\sdata-code="([^"]*)"/g)) {
    const code = (m[1] ?? "").replace(/\u007f|&#x7f;|&#127;/gi, "\n");
    if (hasPrompt(code)) out.push(`copy: a code block copies a "$ " prompt: ${code.slice(0, 50)}`);
  }

  // Every table sits inside the scroll wrapper, so it scrolls inside its box.
  const tables = (html.match(/<table\b/g) ?? []).length;
  const wrapped = (html.match(/class="[^"]*\bdocsx-table-scroll\b[^"]*"/g) ?? []).length;
  if (tables !== wrapped) out.push(`tables: ${tables} tables, ${wrapped} scroll wrappers`);

  if (page === "getting-started/quickstart/index.html") {
    const steps = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)]
      .map((m) => /^\s*(\d+)\./.exec((m[1] ?? "").replace(/<[^>]*>/g, "")))
      .filter((m) => m !== null)
      .map((m) => Number(m[1]));
    if (steps.length < 4 || steps.some((n, i) => n !== i + 1))
      out.push(
        `quickstart: steps are numbered ${steps.join(", ") || "not at all"}, expected 1 to 4 or more`,
      );
  }

  const next = NEXT_LINK[page];
  if (next !== undefined) {
    const links = [...html.matchAll(/<a\b[^>]*\srel="next"[^>]*>/g)].map((m) =>
      attrOf(m[0], "href"),
    );
    if (!links.includes(next))
      out.push(`next: no rel=next link to ${next} (found ${links.join(", ") || "none"})`);
  }

  if (page === "404.html") {
    for (const href of ["/getting-started/quickstart/", "/getting-started/installation/"]) {
      if (!html.includes(`href="${href}"`)) out.push(`404: no link to ${href}`);
    }
  }
  return out;
}

// The search dialog's no-results message comes from the site's i18n override.
const i18n = JSON.parse(readFileSync(join(site, "src", "content", "i18n", "en.json"), "utf8"));
const zero = i18n["pagefind.zero_results"] ?? "";

const problems = [];
if (!zero.includes("[SEARCH_TERM]") || zero.length < 30)
  problems.push(
    "search: pagefind.zero_results in src/content/i18n/en.json lacks [SEARCH_TERM] or a hint",
  );
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
  for (const p of surfaceChecks(page, html)) problems.push(`${page}: ${p}`);
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
