import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViewer } from "../src/render.js";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-viewer-"));
  const flowDir = path.join(tmp, "docs", "recap-open");
  await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(flowDir, "annotations.json"),
    JSON.stringify({
      schema: "site-docs/annotations@1",
      flow: "recap-open",
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
  await fs.writeFile(path.join(flowDir, "screenshots", "open-sidebar.png"), Buffer.from("\x89PNG\r\n\x1a\n-not-a-real-png-"));
  await fs.writeFile(path.join(flowDir, "open-sidebar.md"), "# Open the sidebar\n\nClick the Play button.\n");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("buildViewer", () => {
  it("generates an index + a per-flow page, overlaying annotations and copying screenshots", async () => {
    const outDir = path.join(tmp, "out");
    const r = await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    expect(r.pages).toEqual(["index.html", "recap-open/index.html"]);

    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('src="screenshots/open-sidebar.png"');
    expect(flowHtml).toContain("Click Play to open the recap sidebar");
    expect(flowHtml).toContain("data-anns="); // overlay data embedded (an array — one element per call-out)
    expect(flowHtml).toContain('"bounding_box":{"x":10,"y":20,"width":30,"height":12}');
    expect(flowHtml).toContain("Step write-up"); // the .md is included in a <details>

    // screenshot copied into the viewer output
    await expect(fs.access(path.join(outDir, "recap-open", "screenshots", "open-sidebar.png"))).resolves.toBeUndefined();

    const indexHtml = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(indexHtml).toContain('href="recap-open/index.html"');
  });

  it("produces an (empty) index when there are no flows", async () => {
    const outDir = path.join(tmp, "out2");
    const r = await buildViewer({ docsDir: path.join(tmp, "nonexistent-docs"), outDir });
    expect(r.pages).toEqual(["index.html"]);
    expect(await fs.readFile(path.join(outDir, "index.html"), "utf8")).toContain("no flows");
  });

  it("renders multiple call-outs on the same screenshot as a numbered list + indexed records in data-anns", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "site-docs/annotations@1",
        flow: "recap-open",
        annotations: [
          { step: "open-sidebar", selector: "#a", bounding_box: { x: 1, y: 2, width: 3, height: 4 }, copy: "first thing", index: 1 },
          { step: "open-sidebar", selector: "#b", bounding_box: { x: 5, y: 6, width: 7, height: 8 }, copy: "second thing", index: 2 },
        ],
      }),
    );
    const outDir = path.join(tmp, "out-multi");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('"index":1');
    expect(flowHtml).toContain('"index":2');
    expect(flowHtml).toContain('<ol class="caption-list">');
    expect(flowHtml).toContain("first thing");
    expect(flowHtml).toContain("second thing");
    // both bboxes in the embedded JSON array
    expect(flowHtml).toContain('"bounding_box":{"x":1,"y":2,"width":3,"height":4}');
    expect(flowHtml).toContain('"bounding_box":{"x":5,"y":6,"width":7,"height":8}');
    // a single shot (one step) carries both annotations, so the array length is 2
    expect((flowHtml.match(/data-anns=/g) || []).length).toBe(1);
  });

  it("propagates an annotation's `nudge` offset into the embedded data + viewer JS applies it to callout/arrow only", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "site-docs/annotations@1",
        flow: "recap-open",
        annotations: [
          {
            step: "open-sidebar",
            selector: "#play",
            bounding_box: { x: 10, y: 20, width: 30, height: 12 },
            copy: "nudged",
            nudge: { x: 25, y: -10 },
          },
        ],
      }),
    );
    const outDir = path.join(tmp, "out-nudge");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    // payload embedded
    expect(flowHtml).toContain('"nudge":{"x":25,"y":-10}');
    // viewer JS applies the offset
    expect(flowHtml).toContain("ann.nudge");
  });

  it("escapes HTML in annotation copy", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({ schema: "site-docs/annotations@1", flow: "recap-open", annotations: [{ step: "open-sidebar", selector: "#play", copy: "<script>alert(1)</script> & stuff" }] }),
    );
    const outDir = path.join(tmp, "out3");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).not.toContain("<script>alert(1)</script>");
    expect(flowHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; stuff");
  });
});
