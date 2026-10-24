// Viewer markup edges: copy buttons for odd values, the live-region text of every state, the
// missing-screenshot and failed-image blocks with hostile ids, and the annotation data attribute.

import { describe, expect, it } from "vitest";
import { COPIED_MS, FALLBACK_MS, copyAnnouncement, copyButton } from "../src/viewer-copy.js";
import type { CopyKind } from "../src/viewer-copy.js";
import { flowPageHtml, stepHtml, type ViewerStep } from "../src/viewer-markup.js";

const AT = "@docsxai/viewer 1.2.3";
const step = (over: Partial<ViewerStep> = {}): ViewerStep => ({
  id: "open-sidebar",
  screenshot: "screenshots/open-sidebar.png",
  anns: [{ step: "open-sidebar", selector: "#play", copy: "Click Play" }],
  md: null,
  ...over,
});

describe("copy buttons", () => {
  it.each([["flow id"], ["step id"], ["viewer build"], ["command"]] as [CopyKind][])(
    "name the %s in the accessible name and the data attributes",
    (kind) => {
      const html = copyButton("pay", kind);
      expect(html).toContain(`data-kind="${kind}"`);
      expect(html).toContain(`aria-label="Copy ${kind} pay"`);
      expect(html).toContain('data-state="idle"');
    },
  );

  it("escapes an ampersand once, so an entity in the value is shown as typed", () => {
    expect(copyButton("&lt;", "step id")).toContain('data-copy="&amp;lt;"');
  });

  it("leaves an apostrophe alone inside its double-quoted attribute", () => {
    expect(copyButton("it's", "step id")).toContain('data-copy="it\'s"');
  });

  it("renders an empty value as an empty attribute", () => {
    const html = copyButton("", "step id");
    expect(html).toContain('data-copy=""');
    expect(html).toContain('aria-label="Copy step id "');
  });

  it("keeps the three states' timings apart", () => {
    expect(COPIED_MS).toBe(1500);
    expect(FALLBACK_MS).toBe(5000);
  });
});

describe("the live-region text", () => {
  it("is empty for the idle state", () => {
    expect(copyAnnouncement("idle", "step id", "pay")).toBe("");
  });

  it("names the kind and the value in the done and fallback states", () => {
    expect(copyAnnouncement("done", "command", "docsxai run ws")).toBe(
      "Copied command docsxai run ws to the clipboard.",
    );
    const fallback = copyAnnouncement("fallback", "flow id", "checkout");
    expect(fallback).toContain("flow id checkout is selected");
    expect(fallback).toContain("Cmd+C on a Mac");
  });
});

describe("a step without a usable screenshot", () => {
  it("escapes a hostile step id and flow name in the capture command", () => {
    const html = stepHtml(step({ id: 'a"<b>', screenshot: null }), 1, 'x"<y>/z');
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<y>");
    expect(html).toContain(
      "docsxai run &lt;workspace&gt; --flow x&quot;&lt;y&gt; --start-from a&quot;&lt;b&gt;",
    );
    expect(html).toContain("<code>screenshots/a&quot;&lt;b&gt;.png</code> was not found");
  });

  it("names only the first segment of a variant flow in the command", () => {
    const html = stepHtml(step({ screenshot: null }), 1, "checkout/en.dark.390");
    expect(html).toContain("--flow checkout --start-from open-sidebar");
    expect(html).not.toContain("en.dark.390");
  });

  it("shows the file-name notice and no image for an unsafe step id", () => {
    const html = stepHtml(step({ id: "../x", unsafe: true, screenshot: null }), 1);
    expect(html).toContain("cannot be used as a file name");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("shot-error");
    expect(html).not.toContain('shot-missing" role="status"');
  });
});

describe("a step with a screenshot", () => {
  it("has no data-anns attribute and no caption when there are no annotations", () => {
    const html = stepHtml(step({ anns: [] }), 1);
    expect(html).not.toContain("data-anns");
    expect(html).not.toContain("<figcaption");
    expect(html).toContain(
      '<img src="screenshots/open-sidebar.png" alt="Screenshot of step open-sidebar">',
    );
  });

  it("reserves the image's box when the size is known", () => {
    const html = stepHtml(step({ size: { width: 390, height: 844 } }), 1);
    expect(html).toContain('alt="Screenshot of step open-sidebar" width="390" height="844">');
  });

  it("starts with the failed-image block hidden, naming the file to check", () => {
    const html = stepHtml(step(), 1);
    expect(html).toContain('<p class="shot-error" role="alert" hidden>');
    expect(html).toContain("<code>screenshots/open-sidebar.png</code> is still next to this page");
    expect(html).toContain('<button type="button" class="shot-retry">Retry</button>');
  });

  it("escapes an ampersand in the path in the image and in the failed-image block", () => {
    const html = stepHtml(step({ screenshot: "screenshots/a&b.png" }), 1);
    expect(html).toContain('<img src="screenshots/a&amp;b.png"');
    expect(html).toContain("<code>screenshots/a&amp;b.png</code>");
  });

  it("round-trips annotations with an apostrophe, angle brackets and an ampersand", () => {
    const anns = [
      { step: "open-sidebar", selector: "#a", copy: "It's <b>bold</b> & more", index: 1 },
      { step: "open-sidebar", selector: "#b", copy: 'Say "hi"', index: 2 },
    ];
    const html = stepHtml(step({ anns }), 1);
    const attr = /data-anns='([^']*)'/.exec(html)?.[1];
    expect(attr).toBeDefined();
    const decoded = attr!
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    expect(JSON.parse(decoded)).toEqual(anns);
    expect(html).not.toContain("<b>bold</b>");
  });

  it("lists several annotations as an ordered list and one as a plain caption", () => {
    const many = stepHtml(
      step({
        anns: [
          { step: "s", selector: "#a", copy: "One", index: 1 },
          { step: "s", selector: "#b", copy: "Two", index: 2 },
        ],
      }),
      1,
    );
    expect(many).toContain('<ol class="caption-list"><li>One</li><li>Two</li></ol>');
    expect(stepHtml(step(), 1)).toContain('<figcaption class="caption">Click Play</figcaption>');
  });
});

describe("a flow page with no steps", () => {
  it("still has its heading, a main landmark and the copy button for the flow id", () => {
    const html = flowPageHtml("empty-flow", [], AT, "/*js*/");
    expect(html).toContain("<h1>empty-flow</h1>");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('data-copy="empty-flow" data-kind="flow id"');
    expect(html).not.toContain("<section");
  });

  it("says the flow has no steps and which commands fill it", () => {
    const html = flowPageHtml("empty-flow", [], AT, "");
    expect(html).toContain("This flow has no steps yet.");
    expect(html).toContain("<code>docsxai run</code>");
    expect(html).toContain("<code>docsxai render</code>");
  });
});

describe("notices and neighbours on a flow page", () => {
  it("escapes a notice", () => {
    const html = flowPageHtml("f", [step()], AT, "", { notices: ['bad <file> & "x"'] });
    expect(html).toContain('<p class="notice">bad &lt;file&gt; &amp; &quot;x&quot;</p>');
  });

  it("links to the previous and next flow from a nested flow, escaping the names", () => {
    const html = flowPageHtml("a/b", [step()], AT, "", { neighbours: { prev: "x<y", next: "z" } });
    expect(html).toContain(
      '<a rel="prev" href="../../x&lt;y/index.html">Previous flow: x&lt;y</a>',
    );
    expect(html).toContain('<a rel="next" href="../../z/index.html">Next flow: z</a>');
  });

  it("leaves out the link to a neighbour that does not exist", () => {
    const html = flowPageHtml("a", [step()], AT, "", { neighbours: { next: "b" } });
    expect(html).toContain('rel="next"');
    expect(html).not.toContain('rel="prev"');
  });
});
