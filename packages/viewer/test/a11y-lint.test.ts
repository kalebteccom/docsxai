import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatFinding, lintHtml, linkedStylesheets, type A11yFinding } from "../src/a11y-lint.js";
import { buildViewer } from "../src/render.js";
import { solidPng } from "./helpers/png.js";

interface PageParts {
  lang?: string;
  css?: string;
  before?: string;
  main?: string;
  after?: string;
}

const MOTION = "@media (prefers-reduced-motion: reduce) { * { animation: none; } }";

/** A page that passes every rule; each failing fixture changes one part. */
function page(p: PageParts = {}): string {
  const lang = p.lang ?? ' lang="en"';
  const css = p.css ?? MOTION;
  const before =
    p.before ??
    '<a href="#main">Skip to content</a><header><nav aria-label="Site"><a href="/">Home</a></nav></header>';
  const main = p.main ?? "<h1>Title</h1><h2>Section</h2><p>Text</p>";
  const after = p.after ?? "<footer>Footer</footer>";
  return `<!doctype html><html${lang}><head><title>t</title><style>${css}</style></head><body>${before}<main id="main">${main}</main>${after}</body></html>`;
}

const only = (html: string, rule: string, opts?: Parameters<typeof lintHtml>[1]): A11yFinding[] =>
  lintHtml(html, opts).filter((f) => f.rule === rule);

describe("lintHtml on passing pages", () => {
  it("reports nothing for the baseline page", () => {
    expect(lintHtml(page())).toEqual([]);
  });

  it("accepts the accessible variants of every name rule", () => {
    const main = [
      "<h1>Title</h1>",
      '<label for="q">Search</label><input id="q" type="text">',
      '<label>Name <input type="text"></label>',
      '<input type="text" aria-label="Email">',
      '<span id="cap">Cap</span><select aria-labelledby="cap"><option>a</option></select>',
      '<input type="hidden" name="t"><input type="submit" value="Go">',
      '<a href="/a"><span aria-hidden="true">#</span><span class="sr-only">Section A</span></a>',
      '<a href="/b"><img src="b.png" alt="Logo"></a>',
      '<a href="/c" aria-label="Close"><svg aria-hidden="true"><path d="M0 0"/></svg></a>',
      '<button type="button" title="Copy"><div></div></button>',
      '<img src="d.png" alt="">',
      '<div class="table-scroll" tabindex="0" role="region" aria-label="Wide table"><table></table></div>',
      '<a name="anchor-only">x</a><a href="#top-of-nothing" hidden></a>',
    ].join("");
    expect(lintHtml(page({ main }))).toEqual([]);
  });

  it("orders headings inside main only and leaves nav and aside outlines alone", () => {
    const main = '<nav aria-label="Toc"><h2>On this page</h2></nav><h1>T</h1><h2>S</h2>';
    expect(lintHtml(page({ main }))).toEqual([]);
  });

  it("does not take a negative tabindex or a link without href for a problem", () => {
    const main = '<h1>T</h1><section tabindex="-1"><a>no href</a></section>';
    expect(lintHtml(page({ main }))).toEqual([]);
  });
});

describe("lintHtml on failing pages", () => {
  const cases: Array<[rule: string, html: string, element: string, message: string]> = [
    ["html-lang", page({ lang: "" }), "html", "lang"],
    ["html-lang", page({ lang: ' lang=" "' }), "html", "lang"],
    ["one-h1", page({ main: "<h1>A</h1><h1>B</h1>" }), "document", "found 2"],
    ["one-h1", page({ main: "<p>no heading</p>" }), "document", "found 0"],
    ["heading-order", page({ main: "<h1>A</h1><h3>B</h3>" }), "h3", "skipping a level"],
    ["heading-order", page({ main: "<h2>A</h2><h1>B</h1>" }), "h2", "expected <h1>"],
    ["img-alt", page({ main: '<h1>A</h1><img src="a.png">' }), "img[a.png]", "missing alt"],
    ["form-label", page({ main: '<h1>A</h1><input id="q" type="text">' }), "input#q", "label"],
    ["form-label", page({ main: "<h1>A</h1><textarea></textarea>" }), "textarea", "label"],
    [
      "landmarks",
      page({ before: '<a href="#main">Skip to content</a>', after: "" }),
      "document",
      "no banner",
    ],
    ["landmarks", page({ after: "<main>two</main>" }), "document", "found 2"],
    ["skip-link", page({ before: '<header><a href="/">Home</a></header>' }), "document", "no skip"],
    [
      "skip-link",
      page({ before: '<a href="#content">Skip to content</a><nav aria-label="s"></nav>' }),
      "a[#content]",
      "does not exist",
    ],
    ["tabindex-positive", page({ main: '<h1>A</h1><div tabindex="3">x</div>' }), "div", "tabindex"],
    [
      "empty-link",
      page({ main: '<h1>A</h1><a href="/x"><span aria-hidden="true">#</span></a>' }),
      "a[/x]",
      "no text",
    ],
    [
      "empty-button",
      page({ main: '<h1>A</h1><button type="button"></button>' }),
      "button",
      "no text",
    ],
    ["aria-valid", page({ main: '<h1>A</h1><p aria-lable="x">t</p>' }), "p", "aria-lable"],
    [
      "aria-valid",
      page({ main: '<h1>A</h1><p aria-dropeffect="move">t</p>' }),
      "p",
      "aria-dropeffect",
    ],
    ["aria-valid", page({ main: '<h1>A</h1><div role="banana">t</div>' }), "div", '"banana"'],
    [
      "scroll-region-name",
      page({
        main: '<h1>A</h1><div class="docsx-table-scroll" tabindex="0"><table></table></div>',
      }),
      "div.docsx-table-scroll",
      "aria-label",
    ],
    [
      "scroll-region-name",
      page({ main: '<h1>A</h1><div role="region" tabindex="0">x</div>' }),
      "div",
      "aria-labelledby",
    ],
    [
      "reduced-motion",
      page({ css: "body { color: red; }" }),
      "stylesheet",
      "prefers-reduced-motion",
    ],
    [
      "scrollbar-hidden",
      page({ css: `${MOTION} html { scrollbar-width: none; }` }),
      "stylesheet",
      "scrollbar-width",
    ],
    [
      "scrollbar-hidden",
      page({ css: `${MOTION} .x::-webkit-scrollbar { display: none; }` }),
      "::-webkit-scrollbar",
      "display: none",
    ],
  ];

  for (const [i, [rule, html, element, message]] of cases.entries()) {
    it(`${rule} #${i}: names ${element}`, () => {
      const found = lintHtml(html);
      // Each fixture breaks exactly one rule.
      expect([...new Set(found.map((f) => f.rule))]).toEqual([rule]);
      const lines = found.map(formatFinding).join("\n");
      expect(lines).toContain(`${rule} ${element}:`);
      expect(lines).toContain(message);
    });
  }

  it("reports every unknown aria attribute and role on one element", () => {
    const found = only(
      page({ main: '<h1>A</h1><p aria-foo="1" aria-bar="2" role="x y">t</p>' }),
      "aria-valid",
    );
    expect(found.map((f) => f.message)).toEqual([
      "unknown attribute aria-foo",
      "unknown attribute aria-bar",
      'unknown role "x"',
      'unknown role "y"',
    ]);
  });
});

describe("lintHtml css handling", () => {
  it("checks linked stylesheets passed in with the inline ones", () => {
    const bare = page({ css: "" });
    expect(only(bare, "reduced-motion")).toHaveLength(1);
    expect(only(bare, "reduced-motion", { css: [MOTION] })).toHaveLength(0);
    expect(
      only(bare, "scrollbar-hidden", { css: [MOTION, "* { scrollbar-width:none }"] }),
    ).toHaveLength(1);
  });

  it("skips scrollbar rules in layers whose name starts with a given prefix", () => {
    const layered = `${MOTION} @layer starlight.core { .a { color: red; } @media (min-width: 72rem) { .right-sidebar { overflow-y: auto; scrollbar-width: none; } } } .b { color: blue; }`;
    expect(only(page({ css: layered }), "scrollbar-hidden")).toHaveLength(1);
    expect(
      only(page({ css: layered }), "scrollbar-hidden", { skipLayers: ["starlight"] }),
    ).toHaveLength(0);
    const own = `${layered} @layer site { .c { scrollbar-width: none; } }`;
    expect(
      only(page({ css: own }), "scrollbar-hidden", { skipLayers: ["starlight"] }),
    ).toHaveLength(1);
    const after = `${MOTION} @layer starlight.core{.a{scrollbar-width:none}}.d{scrollbar-width:none}`;
    expect(
      only(page({ css: after }), "scrollbar-hidden", { skipLayers: ["starlight"] }),
    ).toHaveLength(1);
  });

  it("does not take prefers-reduced-motion: no-preference for a reduced-motion block", () => {
    const css = "@media (prefers-reduced-motion: no-preference) { a { transition: none; } }";
    expect(only(page({ css }), "reduced-motion")).toHaveLength(1);
  });

  it("ignores commented-out rules and the scrollbar parts that stay visible", () => {
    const css = `${MOTION} /* html { scrollbar-width: none; } */
      .a::-webkit-scrollbar-thumb { display: none; } .b { scrollbar-width: thin; }
      .c::-webkit-scrollbar { width: 10px; }`;
    expect(only(page({ css }), "scrollbar-hidden")).toHaveLength(0);
  });

  it("lists stylesheet hrefs in order", () => {
    const html =
      '<link rel="preload" href="/f.woff2"><link rel="stylesheet" href="/a.css"><link href="/b.css" rel="Stylesheet"/>';
    expect(linkedStylesheets(html)).toEqual(["/a.css", "/b.css"]);
  });
});

describe("lintHtml parsing", () => {
  it("copes with uppercase tags, unclosed paragraphs, comments and a > inside a quoted value", () => {
    const main =
      "<H1>Title</H1><!-- <h1>comment</h1> --><p>one<p>two<div data-x='a>b'><IMG SRC=x.png ALT=\"\"></div>";
    expect(lintHtml(page({ main }))).toEqual([]);
  });

  it("does not read markup inside script and style text", () => {
    const main = '<h1>A</h1><script>document.write("<h1>x</h1><img src=y>")</script>';
    expect(lintHtml(page({ main }))).toEqual([]);
  });

  it("flags a page that has no html element", () => {
    expect(only("<main><h1>A</h1></main>", "html-lang")[0]?.message).toBe("no <html> element");
  });
});

describe("rendered viewer pages", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-a11y-"));
    for (const flow of ["recap-open", "checkout"]) {
      const flowDir = path.join(tmp, "docs", flow);
      await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
      await fs.writeFile(
        path.join(flowDir, "annotations.json"),
        JSON.stringify({
          schema: "docsxai/annotations@1",
          flow,
          annotations: [
            {
              step: "open-sidebar",
              selector: "#play",
              bounding_box: { x: 10, y: 20, width: 30, height: 12 },
              copy: "Click Play to open the recap sidebar",
              arrow_style: "top-right",
            },
          ],
        }),
      );
      await fs.writeFile(path.join(flowDir, "screenshots", "open-sidebar.png"), solidPng(120, 80));
      await fs.writeFile(
        path.join(flowDir, "open-sidebar.md"),
        "# Open the sidebar\n\nClick the Play button.\n",
      );
    }
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("passes every rule on the index and on each flow page", async () => {
    const outDir = path.join(tmp, "out");
    const r = await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    expect(r.pages).toEqual(["index.html", "checkout/index.html", "recap-open/index.html"]);
    for (const p of r.pages) {
      const html = await fs.readFile(path.join(outDir, p), "utf8");
      expect(lintHtml(html).map((f) => `${p}: ${formatFinding(f)}`)).toEqual([]);
    }
  });

  it("passes on an empty pack", async () => {
    const empty = path.join(tmp, "empty-docs");
    await fs.mkdir(empty);
    const outDir = path.join(tmp, "out-empty");
    await buildViewer({ docsDir: empty, outDir });
    const html = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(lintHtml(html).map(formatFinding)).toEqual([]);
  });
});
