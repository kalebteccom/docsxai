// Viewer markup edges: copy buttons for odd values, the live-region text of every state, the
// missing-screenshot and failed-image blocks with hostile ids, and the annotation data attribute.

import { describe, expect, it } from "vitest";
import { copyAnnouncement, copyButton } from "../src/viewer-copy.js";
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
});

describe("the live-region text", () => {
  it("is empty for the idle state", () => {
    expect(copyAnnouncement("idle", "step id", "pay")).toBe("");
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
});

describe("a flow page with no steps", () => {
  it("still has its heading, a main landmark, the copy button for the flow id and the empty-flow text", () => {
    const html = flowPageHtml("empty-flow", [], AT, "/*js*/");
    expect(html).toContain("<h1>empty-flow</h1>");
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('data-copy="empty-flow" data-kind="flow id"');
    expect(html).not.toContain("<section");
    expect(html).toContain("This flow has no steps yet.");
    expect(html).toContain("<code>docsxai run</code>");
    expect(html).toContain("<code>docsxai render</code>");
  });
});

describe("notices and neighbours on a flow page", () => {
  it("links to the previous and next flow from a nested flow, escaping the names", () => {
    const html = flowPageHtml("a/b", [step()], AT, "", { neighbours: { prev: "x<y", next: "z" } });
    expect(html).toContain(
      '<a rel="prev" href="../../x&lt;y/index.html">Previous flow: x&lt;y</a>',
    );
    expect(html).toContain('<a rel="next" href="../../z/index.html">Next flow: z</a>');
  });
});
