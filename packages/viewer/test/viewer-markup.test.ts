import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../src/viewer-keys.js";
import {
  demoteHeadings,
  flowPageHtml,
  indexHtml,
  shortcutsHtml,
  stepHtml,
  type ViewerStep,
} from "../src/viewer-markup.js";

const AT = "2026-01-02T03:04:05.000Z";

const step = (over: Partial<ViewerStep> = {}): ViewerStep => ({
  id: "open-sidebar",
  screenshot: "screenshots/open-sidebar.png",
  anns: [{ step: "open-sidebar", selector: "#play", copy: "Click Play" }],
  md: null,
  ...over,
});

describe("page landmarks and document outline", () => {
  const html = flowPageHtml("recap-open", [step(), step({ id: "close" })], AT, "");

  it("sets the language, a mobile viewport and a page title naming the flow", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("<title>recap-open · Documentation</title>");
  });

  it("has a skip link to main, a header nav, one main and a footer, in that order", () => {
    const order = [
      '<a class="skip-link" href="#main">Skip to content</a>',
      '<header class="site-header"><nav aria-label="Flows">',
      '<main id="main" tabindex="-1">',
      "</main>",
      '<footer class="meta site-footer">',
    ].map((needle) => html.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  it("links back to the index from a nested variant flow", () => {
    const nested = flowPageHtml("checkout/en.dark.390", [step()], AT, "");
    expect(nested).toContain('href="../../index.html"');
    expect(nested).toContain('<span aria-hidden="true">← </span>All flows');
  });

  it("uses one h1 for the flow and an h2 per step, each step a labelled section", () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain(
      '<section class="step" id="step-1" aria-labelledby="step-1-title" tabindex="-1"><h2 id="step-1-title">open-sidebar</h2>',
    );
    expect(html).toContain('id="step-2" aria-labelledby="step-2-title"');
  });

  it("wraps the screenshot and its caption in a figure with descriptive alt text", () => {
    const one = stepHtml(step(), 1);
    expect(one).toContain('<figure class="shot-figure">');
    expect(one).toContain('alt="Screenshot of step open-sidebar"');
    expect(one).toContain('<figcaption class="caption">Click Play</figcaption>');
  });

  it("captions a multi-call-out step with an ordered list inside the figcaption", () => {
    const anns = [
      { step: "s", selector: "#a", copy: "first", index: 1 },
      { step: "s", selector: "#b", copy: "second", index: 2 },
    ];
    expect(stepHtml(step({ anns }), 1)).toContain(
      '<figcaption><ol class="caption-list"><li>first</li><li>second</li></ol></figcaption>',
    );
  });

  it("puts the render time in a machine-readable time element", () => {
    expect(html).toContain(`Rendered <time datetime="${AT}">${AT}</time>.`);
  });
});

describe("step write-up headings", () => {
  it("demotes write-up headings two levels, capped at h6", () => {
    expect(demoteHeadings("<h1>a</h1><h2>b</h2><h4>c</h4><h5>d</h5><h6>e</h6>")).toBe(
      "<h3>a</h3><h4>b</h4><h6>c</h6><h6>d</h6><h6>e</h6>",
    );
  });

  it("leaves other tags and heading-like text alone", () => {
    expect(demoteHeadings("<p>h1</p><hr><header>")).toBe("<p>h1</p><hr><header>");
  });

  it("applies to the rendered write-up", () => {
    const html = stepHtml(step({ md: "# Title\n\n## Sub\n" }), 1);
    expect(html).toContain("<h3>Title</h3>");
    expect(html).toContain("<h4>Sub</h4>");
    expect(html).not.toMatch(/<h[12]>(Title|Sub)/);
  });
});

describe("index page", () => {
  it("lists flows as a list of links inside main", () => {
    const html = indexHtml(
      [{ flow: "a", steps: 2, annotations: 1, thumb: "a/screenshots/x.png" }],
      AT,
    );
    expect(html).toContain(
      '<ul class="flow-grid" role="list"><li><a class="flow-card" href="./a/index.html">',
    );
    expect(html).toContain("<span>2 steps, 1 annotation</span>");
    // a decorative thumbnail: the card's text names the flow
    expect(html).toMatch(/<img src="a\/screenshots\/x.png" alt=""/);
  });
});

describe("index card links", () => {
  it("start with ./ so a flow name cannot read as a URL scheme", () => {
    const html = indexHtml([{ flow: "javascript:x", steps: 1, annotations: 0, thumb: null }], AT);
    expect(html).toContain('href="./javascript:x/index.html"');
    expect(html).not.toContain('href="javascript:');
  });
});

describe("keyboard navigation markup", () => {
  it("links the previous and next flow with rel, from a nested flow", () => {
    const html = flowPageHtml("b/en", [step()], AT, "", {
      neighbours: { prev: "a", next: "c/en" },
    });
    expect(html).toContain('<a rel="prev" href="../../a/index.html">Previous flow: a</a>');
    expect(html).toContain('<a rel="next" href="../../c/en/index.html">Next flow: c/en</a>');
  });

  it("omits the flow links at either end", () => {
    const html = flowPageHtml("a", [step()], AT, "", { neighbours: { next: "b" } });
    expect(html).not.toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });

  it("has a polite, atomic live region for step announcements", () => {
    const html = flowPageHtml("a", [step()], AT, "");
    expect(html).toContain(
      '<div id="sd-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>',
    );
  });

  it("documents every shortcut on a flow page, and only step keys on the index", () => {
    const flow = shortcutsHtml(true);
    expect(flow).toContain("<summary>Keyboard shortcuts</summary>");
    for (const s of SHORTCUTS) expect(flow).toContain(`<dd>${s.description}</dd>`);
    expect(flow).toContain("<dt><kbd>→</kbd> or <kbd>j</kbd></dt>");
    const index = shortcutsHtml(false);
    expect(index).toContain("<dd>Next step</dd>");
    expect(index).not.toContain("<dd>Next flow</dd>");
    expect(index).not.toContain("<kbd>Esc</kbd>");
  });

  it("renders the shortcuts in the flow page header and the index header", () => {
    expect(flowPageHtml("a", [step()], AT, "")).toContain(shortcutsHtml(true));
    const index = indexHtml([{ flow: "a", steps: 1, annotations: 0, thumb: null }], AT, "/*js*/");
    expect(index).toContain(`<header class="site-header">${shortcutsHtml(false)}</header>`);
    expect(index).toContain("<script>/*js*/</script>");
  });

  it("emits no script and no shortcuts on an empty index", () => {
    const index = indexHtml([], AT);
    expect(index).not.toContain("<script>");
    expect(index).not.toContain("Keyboard shortcuts");
  });
});

describe("layout stability", () => {
  it("writes the PNG's intrinsic size on the screenshot so its box is reserved", () => {
    const html = stepHtml(step({ size: { width: 1280, height: 800 } }), 1);
    expect(html).toContain('alt="Screenshot of step open-sidebar" width="1280" height="800">');
  });

  it("leaves the size off when it is unknown", () => {
    expect(stepHtml(step({ size: null }), 1)).not.toMatch(/<img[^>]* width=/);
  });

  it("lazy-loads index thumbnails (their box is fixed by CSS)", () => {
    const html = indexHtml([{ flow: "a", steps: 1, annotations: 0, thumb: "a/s/x.png" }], AT);
    expect(html).toContain('<img src="a/s/x.png" alt="" loading="lazy" decoding="async">');
  });
});

describe("empty, error and loading states", () => {
  it("says so when a flow has no steps", () => {
    const html = flowPageHtml("a", [], AT, "");
    expect(html).toContain('<p class="empty">This flow has no steps yet.');
    expect(html).not.toContain('<section class="step"');
  });

  it("shows a placeholder for a step without a screenshot and keeps its caption", () => {
    const html = stepHtml(step({ screenshot: null }), 1);
    expect(html).toContain('<p class="shot-missing">No screenshot was captured for this step.</p>');
    expect(html).toContain('<figcaption class="caption">Click Play</figcaption>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("shot-error");
  });

  it("shows an error state for a step whose id is not a safe file name", () => {
    const html = stepHtml(step({ id: "../x", screenshot: null, anns: [], unsafe: true }), 1);
    expect(html).toContain(
      '<p class="shot-missing" role="alert">This step\'s name cannot be used as a file name, so its screenshot and write-up were left out.</p>',
    );
    expect(html).toContain('<h2 id="step-1-title">../x</h2>');
    expect(html).not.toContain("<img");
  });

  it("ships a hidden error line with a Retry button next to every screenshot", () => {
    const html = stepHtml(step(), 1);
    expect(html).toContain(
      '</div><p class="shot-error" role="alert" hidden>The screenshot failed to load. <button type="button" class="shot-retry">Retry</button></p>',
    );
  });

  it("renders notices about a damaged annotations file above the steps, escaped", () => {
    const html = flowPageHtml("a", [step()], AT, "", { notices: ["bad <file>"] });
    expect(html).toContain('<h1>a</h1><p class="notice">bad &lt;file&gt;</p><section');
  });

  it("renders no notice markup when there is nothing to report", () => {
    expect(flowPageHtml("a", [step()], AT, "")).not.toContain('class="notice"');
  });

  it("says so on an empty index", () => {
    expect(indexHtml([], AT)).toContain(
      '<p class="empty">No flows yet. Run <code>docsxai run</code>, then <code>docsxai render</code>.</p>',
    );
  });

  it("shows a placeholder card for a flow without screenshots", () => {
    const html = indexHtml([{ flow: "a", steps: 0, annotations: 0, thumb: null }], AT);
    expect(html).toContain('<div class="thumb-missing">No screenshot</div>');
    expect(html).toContain("<span>0 steps</span>");
  });
});
