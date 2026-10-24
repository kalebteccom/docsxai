import { describe, expect, it } from "vitest";
import { flowPageHtml, indexHtml, stepHtml, type ViewerStep } from "../src/viewer-markup.js";

const AT = "@docsxai/viewer 1.2.3";

const step = (over: Partial<ViewerStep> = {}): ViewerStep => ({
  id: "a",
  screenshot: "screenshots/a.png",
  anns: [],
  md: null,
  ...over,
});

describe("URLs built from flow names and step ids", () => {
  it("percent-encodes #, ? and % in the screenshot URL and keeps the file name in the text", () => {
    const html = stepHtml(step({ id: "a#b?c%d", screenshot: "screenshots/a#b?c%d.png" }), 1);
    expect(html).toContain('<img src="screenshots/a%23b%3Fc%25d.png"');
    expect(html).toContain("<code>screenshots/a#b?c%d.png</code>");
  });

  it("percent-encodes a flow name in the previous, next and all-flows links", () => {
    const html = flowPageHtml("f#1", [step()], AT, "", {
      neighbours: { prev: "p?q", next: "n%20x" },
    });
    expect(html).toContain('href="../p%3Fq/index.html"');
    expect(html).toContain('href="../n%2520x/index.html"');
    expect(html).toContain("Previous flow: p?q");
  });

  it("percent-encodes the flow name and thumbnail on an index card", () => {
    const html = indexHtml(
      [{ flow: "f#1/en", steps: 1, annotations: 0, thumb: "f#1/en/screenshots/a#b.png" }],
      AT,
    );
    expect(html).toContain('href="./f%231/en/index.html"');
    expect(html).toContain('<img src="f%231/en/screenshots/a%23b.png"');
    expect(html).toContain('data-copy="f#1/en"');
  });

  it("leaves a plain name and an ampersand as they were", () => {
    const html = stepHtml(step({ screenshot: "screenshots/a&b.png" }), 1);
    expect(html).toContain('<img src="screenshots/a&amp;b.png"');
  });
});
