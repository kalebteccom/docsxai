import { describe, expect, it } from "vitest";
import { COPIED_MS, copyAnnouncement, copyButton } from "../src/viewer-copy.js";
import { SHORTCUTS } from "../src/viewer-keys.js";
import {
  demoteHeadings,
  flowPageHtml,
  indexHtml,
  shortcutsHtml,
  stepHtml,
  type ViewerStep,
} from "../src/viewer-markup.js";

const AT = "@docsxai/viewer 1.2.3";

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
      '<section class="step" id="step-1" aria-labelledby="step-1-title" tabindex="-1"><div class="id-row"><h2 id="step-1-title">open-sidebar</h2><button type="button" class="sd-copy" data-copy="open-sidebar"',
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

  it("names the viewer build in the footer and carries no clock", () => {
    expect(html).toContain(`Rendered by <span class="sd-id">${AT}</span>. Hard-reload`);
    expect(html).not.toContain("<time");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
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
    expect(html).toMatch(
      /<main[^>]*>[\s\S]*<ul class="flow-grid" role="list"><li[^>]*><a class="flow-card" href="\.\/a\/index\.html">[\s\S]*<\/li><\/ul>[\s\S]*<\/main>/,
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
    // the stylesheet names .sd-copy, so look for the element, not the class name
    expect(index).not.toContain('<button type="button" class="sd-copy"');
    expect(index).not.toContain("data-copy=");
    expect(index).not.toContain("sd-live");
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
    expect(html).toContain(
      '<div class="shot-missing" role="status"><p>No screenshot for this step.',
    );
    expect(html).toContain('<figcaption class="caption">Click Play</figcaption>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("shot-error");
  });

  it("gives the reason and the command that captures a missing screenshot again", () => {
    const html = stepHtml(step({ screenshot: null }), 1, "checkout/en.dark");
    expect(html).toContain("<code>screenshots/open-sidebar.png</code> was not found");
    const cmd = "docsxai run &lt;workspace&gt; --flow checkout --start-from open-sidebar";
    expect(html).toContain(`<code class="sd-id">${cmd}</code>`);
    expect(html).toContain(`data-copy="${cmd}" data-kind="command"`);
    expect(html).toContain("then run <code>docsxai render &lt;workspace&gt;</code>");
    expect(stepHtml(step({ screenshot: null }), 1)).toContain("run &lt;workspace&gt; --start-from");
  });

  it("shows an error state for a step whose id is not a safe file name", () => {
    const html = stepHtml(step({ id: "../x", screenshot: null, anns: [], unsafe: true }), 1);
    expect(html).toContain(
      '<p class="shot-missing" role="alert">This step\'s name cannot be used as a file name, so its screenshot and write-up were left out. Rename the step in the flow file, then run <code>docsxai run</code> and <code>docsxai render</code> again.</p>',
    );
    expect(html).toContain('<h2 id="step-1-title">../x</h2>');
    expect(html).not.toContain("<img");
  });

  it("ships a hidden error line with a Retry button next to every screenshot", () => {
    const html = stepHtml(step(), 1);
    expect(html).toContain(
      '</div><p class="shot-error" role="alert" hidden><span class="shot-error-msg">The screenshot for step open-sidebar could not be loaded. Check that <code>screenshots/open-sidebar.png</code> is still next to this page, then press Retry.</span> <button type="button" class="shot-retry">Retry</button></p>',
    );
  });

  it("renders notices about a damaged annotations file above the steps, escaped", () => {
    const html = flowPageHtml("a", [step()], AT, "", { notices: ["bad <file>"] });
    expect(html).toContain('</div><p class="notice">bad &lt;file&gt;</p><section');
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
    expect(html).toContain(
      '<div class="thumb-missing">No screenshot yet. Open the flow to see how to capture it.</div>',
    );
    expect(html).toContain("<span>No steps yet</span>");
    expect(indexHtml([{ flow: "a", steps: 1, annotations: 0, thumb: null }], AT)).toContain(
      "<span>1 step</span>",
    );
  });
});

describe("copy buttons", () => {
  const flow = flowPageHtml("checkout/en.dark", [step(), step({ id: "pay" })], AT, "/*js*/");

  it("puts a copy button after the flow id and after every step id, outside the headings", () => {
    expect(flow).toContain(
      '<div class="id-row"><h1>checkout/en.dark</h1><button type="button" class="sd-copy" data-copy="checkout/en.dark" data-kind="flow id" data-state="idle" aria-label="Copy flow id checkout/en.dark">',
    );
    expect(flow).toContain('data-copy="open-sidebar" data-kind="step id"');
    expect(flow).toContain('aria-label="Copy step id pay"');
    expect(flow).not.toMatch(/<h[12][^>]*>[^<]*<button/);
  });

  it("holds all three labels in one button so its width never changes", () => {
    const one = copyButton("x", "step id");
    expect(one).toContain(
      '<span class="sd-copy-label sd-copy-idle" aria-hidden="true">Copy</span>',
    );
    expect(one).toContain(
      '<span class="sd-copy-label sd-copy-done" aria-hidden="true">Copied</span>',
    );
    expect(one).toContain(
      '<span class="sd-copy-label sd-copy-fallback" aria-hidden="true">Press Ctrl+C</span>',
    );
    expect(COPIED_MS).toBe(1500);
  });

  it("escapes the value in the attribute and the accessible name", () => {
    const one = copyButton('a"<b>&', "step id");
    expect(one).toContain('data-copy="a&quot;&lt;b&gt;&amp;"');
    expect(one).toContain('aria-label="Copy step id a&quot;&lt;b&gt;&amp;"');
    expect(one).not.toContain("<b>");
  });

  it("copies the viewer build from the footer and puts a button beside each index card", () => {
    expect(flow).toContain('data-copy="@docsxai/viewer 1.2.3" data-kind="viewer build"');
    const index = indexHtml([{ flow: "a/b", steps: 2, annotations: 0, thumb: null }], AT, "/*js*/");
    expect(index).toContain('<strong class="sd-id">a/b</strong>');
    expect(index).toContain('</a><button type="button" class="sd-copy" data-copy="a/b"');
    expect(index).toContain('id="sd-live"');
  });

  it("announces the copy through the polite live region", () => {
    expect(copyAnnouncement("done", "step id", "pay")).toBe("Copied step id pay to the clipboard.");
    expect(copyAnnouncement("fallback", "step id", "pay")).toContain("press Ctrl+C");
    expect(flow).toContain('id="sd-live" class="sr-only" aria-live="polite"');
  });
});
