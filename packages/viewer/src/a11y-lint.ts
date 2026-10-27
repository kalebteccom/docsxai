// Static accessibility and UX lint over generated HTML. Pure string in, findings out: no IO, no
// browser, no dependency. Tests run it over rendered viewer pages, and website/scripts/
// check-a11y-surface.mjs runs the same module over the built docs site. Not part of the package's
// public surface (index.ts does not export it). The file carries no TypeScript-only runtime
// syntax (no enums, namespaces or parameter properties) so Node can import it directly.

export interface A11yFinding {
  /** Stable rule id, e.g. `img-alt`. */
  rule: string;
  /** Short description of the offending element, e.g. `img[src="a.png"]`. */
  element: string;
  message: string;
}

export interface A11yLintOptions {
  /** Stylesheets that are not inline in the page (linked files), checked with the inline ones. */
  css?: string[];
  /**
   * Layer-name prefixes (e.g. `starlight`) whose `@layer` blocks the scrollbar rules skip. A
   * layered rule loses to an unlayered one, so a framework's layered `scrollbar-width: none` is
   * not the page's own choice.
   */
  skipLayers?: string[];
}

interface HtmlNode {
  tag: string;
  attrs: Map<string, string>;
  children: Array<HtmlNode | string>;
  parent: HtmlNode | null;
}

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style"]);

// Comments, CDATA and doctype match without a name group; tags capture the closing slash, the
// name and the attribute text. Quoted attribute values may contain `>`.
const TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![a-zA-Z][^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = (m[1] ?? "").toLowerCase();
    if (name !== "" && !attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** A tolerant tree: unclosed elements close at the next ancestor's end tag, stray end tags are dropped. */
function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "#root", attrs: new Map(), children: [], parent: null };
  let cur = root;
  let pos = 0;
  const re = new RegExp(TAG_RE.source, "g");
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    if (m.index > pos) cur.children.push(html.slice(pos, m.index));
    pos = re.lastIndex;
    const name = m[2];
    if (name === undefined) continue;
    const tag = name.toLowerCase();
    if (m[1] === "/") {
      for (let up: HtmlNode | null = cur; up !== null; up = up.parent) {
        if (up.tag === tag) {
          cur = up.parent ?? root;
          break;
        }
      }
      continue;
    }
    const rawAttrs = m[3] ?? "";
    const node: HtmlNode = { tag, attrs: parseAttrs(rawAttrs), children: [], parent: cur };
    cur.children.push(node);
    if (VOID.has(tag) || rawAttrs.trimEnd().endsWith("/")) continue;
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "ig");
      close.lastIndex = pos;
      const end = close.exec(html);
      node.children.push(html.slice(pos, end ? end.index : html.length));
      pos = end ? close.lastIndex : html.length;
      re.lastIndex = pos;
      continue;
    }
    cur = node;
  }
  if (pos < html.length) cur.children.push(html.slice(pos));
  return root;
}

function elements(node: HtmlNode, out: HtmlNode[] = []): HtmlNode[] {
  for (const c of node.children) {
    if (typeof c === "string") continue;
    out.push(c);
    elements(c, out);
  }
  return out;
}

const attr = (n: HtmlNode, name: string): string => (n.attrs.get(name) ?? "").trim();
const textOnly = (n: HtmlNode): string =>
  n.children.map((c) => (typeof c === "string" ? c : "")).join("");
const squash = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Text a screen reader would read inside a node: skips hidden subtrees, uses alt and aria-label. */
function readableText(n: HtmlNode): string {
  let out = "";
  for (const c of n.children) {
    if (typeof c === "string") {
      out += c;
      continue;
    }
    if (RAW_TEXT.has(c.tag) || c.attrs.has("hidden") || attr(c, "aria-hidden") === "true") continue;
    const label = attr(c, "aria-label");
    if (label !== "") out += ` ${label} `;
    else if (c.tag === "img") out += ` ${attr(c, "alt")} `;
    else out += ` ${readableText(c)} `;
  }
  return squash(out);
}

function isHidden(n: HtmlNode): boolean {
  for (let up: HtmlNode | null = n; up !== null; up = up.parent) {
    if (up.attrs.has("hidden")) return true;
  }
  return false;
}

const CHROME = new Set(["nav", "aside", "header", "footer", "dialog"]);

function inChrome(n: HtmlNode): boolean {
  for (let up = n.parent; up !== null; up = up.parent) {
    if (CHROME.has(up.tag)) return true;
  }
  return false;
}

/** `tag#id.first-class[src|href]`, cut to 80 characters. */
function describe(n: HtmlNode): string {
  const id = attr(n, "id");
  const cls = attr(n, "class").split(/\s+/)[0] ?? "";
  const ref = attr(n, "src") || attr(n, "href") || attr(n, "name");
  let s = n.tag;
  if (id !== "") s += `#${id}`;
  if (cls !== "") s += `.${cls}`;
  if (ref !== "") s += `[${ref}]`;
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

const ARIA_ATTRS = new Set(
  (
    "activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount " +
    "colindex colindextext colspan controls current describedby description details disabled " +
    "errormessage expanded flowto haspopup hidden invalid keyshortcuts label labelledby level live " +
    "modal multiline multiselectable orientation owns placeholder posinset pressed readonly " +
    "relevant required roledescription rowcount rowindex rowindextext rowspan selected setsize sort " +
    "valuemax valuemin valuenow valuetext"
  )
    .split(" ")
    .map((a) => `aria-${a}`),
);

const ROLES = new Set(
  (
    "alert alertdialog application article banner blockquote button caption cell checkbox code " +
    "columnheader combobox complementary contentinfo definition deletion dialog directory document " +
    "emphasis feed figure form generic grid gridcell group heading img insertion link list listbox " +
    "listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter " +
    "navigation none note option paragraph presentation progressbar radio radiogroup region row " +
    "rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong " +
    "subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar " +
    "tooltip tree treegrid treeitem graphics-document graphics-object graphics-symbol"
  ).split(" "),
);

const NATIVE_FOCUSABLE = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const UNLABELLED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

interface Ctx {
  root: HtmlNode;
  all: HtmlNode[];
  ids: Set<string>;
  css: string;
  skipLayers: string[];
  add: (rule: string, element: string, message: string) => void;
}

/** True when the node has an accessible name from aria-label, a resolvable aria-labelledby or title. */
function namedByAttr(n: HtmlNode, ids: Set<string>): boolean {
  if (attr(n, "aria-label") !== "") return true;
  if (
    attr(n, "aria-labelledby")
      .split(/\s+/)
      .some((id) => ids.has(id))
  )
    return true;
  return attr(n, "title") !== "";
}

function checkDocument(c: Ctx): void {
  const html = c.all.find((n) => n.tag === "html");
  if (html === undefined) c.add("html-lang", "document", "no <html> element");
  else if (attr(html, "lang") === "") c.add("html-lang", "html", "missing a non-empty lang");

  const h1s = c.all.filter((n) => n.tag === "h1");
  if (h1s.length !== 1)
    c.add("one-h1", "document", `expected exactly one <h1>, found ${h1s.length}`);

  const mains = c.all.filter((n) => n.tag === "main" || attr(n, "role") === "main");
  if (mains.length !== 1)
    c.add("landmarks", "document", `expected one main, found ${mains.length}`);
  const others = c.all.filter(
    (n) =>
      ["header", "nav", "footer"].includes(n.tag) ||
      ["banner", "navigation", "contentinfo"].includes(attr(n, "role")),
  );
  if (others.length === 0)
    c.add("landmarks", "document", "no banner, navigation or contentinfo landmark");

  // Headings are ordered inside main. Headings in a nav, aside, header, footer or dialog (a
  // table of contents titled "On this page") belong to that region's own outline.
  const scope = mains[0] ?? c.root;
  let prev = 0;
  for (const h of elements(scope).filter((n) => /^h[1-6]$/.test(n.tag) && !inChrome(n))) {
    const level = Number(h.tag.slice(1));
    if (level > prev + 1) {
      c.add(
        "heading-order",
        describe(h),
        prev === 0
          ? `first heading is <${h.tag}>, expected <h1>`
          : `<${h.tag}> follows <h${prev}>, skipping a level`,
      );
    }
    prev = level;
  }

  const skip = c.all.find(
    (n) => n.tag === "a" && attr(n, "href").startsWith("#") && /skip/i.test(readableText(n)),
  );
  if (skip === undefined) c.add("skip-link", "document", "no skip link to the main content");
  else {
    let target = attr(skip, "href").slice(1);
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep the raw fragment
    }
    if (target === "" || !c.ids.has(target))
      c.add("skip-link", describe(skip), `target #${target} does not exist`);
  }
}

// Decorative glyphs: arrows, dingbats (check marks, crosses, stars), geometric shapes, emoji and
// separator dots. A screen reader reads each one by name ("rightwards arrow"), so a glyph that sits
// next to link or status text goes in its own aria-hidden element.
const GLYPH_RE = /[·•←-⇿⌀-⏿■-➿⤀-⥿⬀-⯿\u{1F000}-\u{1FAFF}]/u;
const GLYPH_SKIP = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "title"]);
const BADGE_CLASS = /\b[\w-]*(badge|chip|pill|tag|status|count|counter)[\w-]*\b/i;
// Inline wrappers that carry no component styling: `foo<code>bar</code>` is one word on purpose.
const PLAIN_INLINE = new Set(
  "code em strong b i u a sub sup abbr mark kbd samp var wbr br svg img".split(" "),
);

function isAriaHidden(n: HtmlNode): boolean {
  for (let up: HtmlNode | null = n; up !== null; up = up.parent) {
    if (up.attrs.has("hidden") || attr(up, "aria-hidden") === "true") return true;
  }
  return false;
}

/** Text a screen reader joins without padding: inline elements add no space of their own. */
function joinedName(n: HtmlNode): string {
  let out = "";
  for (const c of n.children) {
    if (typeof c === "string") {
      out += c;
      continue;
    }
    if (RAW_TEXT.has(c.tag) || c.attrs.has("hidden") || attr(c, "aria-hidden") === "true") continue;
    const label = attr(c, "aria-label");
    out += label !== "" ? label : c.tag === "img" ? attr(c, "alt") : joinedName(c);
  }
  return out.replace(/&nbsp;|&#160;|&#xa0;/gi, " ");
}

const GLYPH_HOSTS = new Set(["a", "button", "summary", "label"]);

/** Prose arrows are content. Only glyphs inside controls, status roles and badges are decoration. */
function inControlOrBadge(n: HtmlNode): boolean {
  for (let up: HtmlNode | null = n; up !== null; up = up.parent) {
    if (GLYPH_HOSTS.has(up.tag)) return true;
    if (["status", "alert"].includes(attr(up, "role"))) return true;
    if (BADGE_CLASS.test(attr(up, "class"))) return true;
  }
  return false;
}

function checkSemantics(c: Ctx): void {
  // A region labelled by aria-labelledby titles itself with a heading, never a <p> or a <div>.
  const byId = new Map<string, HtmlNode>();
  for (const n of c.all) {
    const id = attr(n, "id");
    if (id !== "" && !byId.has(id)) byId.set(id, n);
  }
  for (const n of c.all) {
    const ref = attr(n, "aria-labelledby");
    if (ref === "" || !["section", "div", "aside", "nav", "form", "article"].includes(n.tag))
      continue;
    if (attr(n, "role") !== "" && attr(n, "role") !== "region") continue;
    for (const id of ref.split(/\s+/)) {
      const t = byId.get(id);
      if (t === undefined) continue;
      if (["p", "div", "span"].includes(t.tag) && attr(t, "role") !== "heading")
        c.add(
          "labelledby-heading",
          describe(n),
          `labelled by <${t.tag} id="${id}">, which is not a heading (h2 to h6)`,
        );
    }
  }

  // Decorative glyphs sit in their own aria-hidden element. Outside one, a glyph is read aloud.
  for (const n of c.all) {
    if (GLYPH_SKIP.has(n.tag) || isAriaHidden(n)) continue;
    let inSkipped = false;
    for (let up: HtmlNode | null = n; up !== null; up = up.parent)
      inSkipped ||= GLYPH_SKIP.has(up.tag);
    if (inSkipped || !inControlOrBadge(n)) continue;
    for (const child of n.children) {
      if (typeof child !== "string") continue;
      const text = child.replace(/&[#\w]+;/g, " ");
      const m = GLYPH_RE.exec(text);
      if (m !== null)
        c.add(
          "glyph-hidden",
          describe(n),
          `decorative glyph "${m[0]}" is not inside an aria-hidden element`,
        );
    }
  }

  // A badge next to heading or link text needs a real space, or the name reads "DeveloperYour plan".
  const namers = c.all.filter(
    (n) => /^h[1-6]$/.test(n.tag) || n.tag === "a" || n.tag === "button" || n.tag === "summary",
  );
  for (const n of namers) {
    if (isAriaHidden(n)) continue;
    const kids = n.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k === undefined || typeof k === "string") continue;
      if (PLAIN_INLINE.has(k.tag) && !BADGE_CLASS.test(attr(k, "class"))) continue;
      if (isAriaHidden(k) || joinedName(k).trim() === "") continue;
      const before =
        i > 0
          ? kids
              .slice(0, i)
              .map((x) => (typeof x === "string" ? x : joinedName(x)))
              .join("")
          : "";
      const after = kids
        .slice(i + 1)
        .map((x) => (typeof x === "string" ? x : joinedName(x)))
        .join("");
      const inner = joinedName(k);
      const tight = (a: string, b: string): boolean =>
        /[\p{L}\p{N}]$/u.test(a) && /^[\p{L}\p{N}]/u.test(b);
      if (tight(before, inner) || tight(inner, after))
        c.add(
          "badge-space",
          describe(n),
          `<${k.tag}> text runs into its neighbour ("${joinedName(n).trim().slice(0, 40)}"): add a real space`,
        );
    }
  }
}

function checkNames(c: Ctx): void {
  for (const n of c.all.filter((e) => e.tag === "img")) {
    if (!n.attrs.has("alt"))
      c.add("img-alt", describe(n), 'missing alt (use alt="" if decorative)');
  }

  const labelFor = new Set(
    c.all
      .filter((n) => n.tag === "label")
      .map((n) => attr(n, "for"))
      .filter((f) => f !== ""),
  );
  for (const n of c.all) {
    const isControl =
      (n.tag === "input" && !UNLABELLED_INPUT_TYPES.has(attr(n, "type").toLowerCase())) ||
      n.tag === "select" ||
      n.tag === "textarea";
    if (!isControl || isHidden(n)) continue;
    let wrapped = false;
    for (let up = n.parent; up !== null; up = up.parent) wrapped ||= up.tag === "label";
    const id = attr(n, "id");
    if (!wrapped && !namedByAttr(n, c.ids) && !(id !== "" && labelFor.has(id)))
      c.add("form-label", describe(n), "form control has no label, aria-label or aria-labelledby");
  }

  for (const n of c.all) {
    const isLink = n.tag === "a" && n.attrs.has("href");
    const isButton = n.tag === "button" || attr(n, "role") === "button";
    if ((!isLink && !isButton) || isHidden(n) || attr(n, "aria-hidden") === "true") continue;
    if (!namedByAttr(n, c.ids) && readableText(n) === "")
      c.add(isLink ? "empty-link" : "empty-button", describe(n), "no text or accessible name");
  }
}

function checkAttributes(c: Ctx): void {
  for (const n of c.all) {
    const tab = attr(n, "tabindex");
    if (tab !== "" && Number(tab) > 0)
      c.add("tabindex-positive", describe(n), `tabindex="${tab}" reorders the tab sequence`);

    for (const name of n.attrs.keys()) {
      if (name.startsWith("aria-") && !ARIA_ATTRS.has(name))
        c.add("aria-valid", describe(n), `unknown attribute ${name}`);
    }
    const role = attr(n, "role").toLowerCase();
    for (const r of role === "" ? [] : role.split(/\s+/)) {
      if (!ROLES.has(r)) c.add("aria-valid", describe(n), `unknown role "${r}"`);
    }

    // A focusable element that scrolls (a table wrapper, a code panel) is announced by its name.
    const focusable = tab !== "" && Number(tab) >= 0 && !NATIVE_FOCUSABLE.has(n.tag);
    const scroller = role === "region" || /scroll/i.test(attr(n, "class"));
    if (focusable && scroller && !namedByAttr(n, c.ids))
      c.add(
        "scroll-region-name",
        describe(n),
        "focusable scroll region has no aria-label or aria-labelledby",
      );
  }
}

/** Drops `@layer <name> { ... }` blocks whose name starts with one of the prefixes. */
function withoutLayers(css: string, prefixes: string[]): string {
  if (prefixes.length === 0) return css;
  const re = /@layer\s+([\w.-]+)\s*\{/g;
  let out = "";
  let from = 0;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    const name = m[1] ?? "";
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    let depth = 1;
    let end = re.lastIndex;
    for (; end < css.length && depth > 0; end++) {
      const ch = css.charAt(end);
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    out += css.slice(from, m.index);
    from = end;
    re.lastIndex = end;
  }
  return out + css.slice(from);
}

function checkCss(c: Ctx): void {
  const all = c.css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!/@media[^{]*prefers-reduced-motion\s*:\s*reduce/i.test(all))
    c.add("reduced-motion", "stylesheet", "no @media (prefers-reduced-motion: reduce) block");
  const css = withoutLayers(all, c.skipLayers);
  if (/scrollbar-width\s*:\s*none/i.test(css))
    c.add("scrollbar-hidden", "stylesheet", "scrollbar-width: none hides the scrollbar");
  for (const m of css.matchAll(/::-webkit-scrollbar(?![-\w])[^{}]*\{([^{}]*)\}/gi)) {
    if (/display\s*:\s*none/i.test(m[1] ?? ""))
      c.add("scrollbar-hidden", "::-webkit-scrollbar", "display: none hides the scrollbar");
  }
}

/** Lint one page. Findings come out in rule order, then document order. */
export function lintHtml(html: string, opts: A11yLintOptions = {}): A11yFinding[] {
  const root = parseHtml(html);
  const all = elements(root);
  const findings: A11yFinding[] = [];
  const inline = all.filter((n) => n.tag === "style").map(textOnly);
  const ctx: Ctx = {
    root,
    all,
    ids: new Set(all.map((n) => attr(n, "id")).filter((id) => id !== "")),
    css: [...inline, ...(opts.css ?? [])].join("\n"),
    skipLayers: opts.skipLayers ?? [],
    add: (rule, element, message) => findings.push({ rule, element, message }),
  };
  checkDocument(ctx);
  checkNames(ctx);
  checkSemantics(ctx);
  checkAttributes(ctx);
  checkCss(ctx);
  return findings;
}

/** `rule element: message`, one line, for test output and the website check. */
export function formatFinding(f: A11yFinding): string {
  return `${f.rule} ${f.element}: ${f.message}`;
}

/** Hrefs of stylesheets a page links, in order (for callers that load them from disk). */
export function linkedStylesheets(html: string): string[] {
  return elements(parseHtml(html))
    .filter(
      (n) => n.tag === "link" && attr(n, "rel").toLowerCase().split(/\s+/).includes("stylesheet"),
    )
    .map((n) => attr(n, "href"))
    .filter((h) => h !== "");
}
