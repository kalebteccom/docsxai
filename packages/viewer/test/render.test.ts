import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViewer } from "../src/render.js";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-"));
  const flowDir = path.join(tmp, "docs", "recap-open");
  await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(flowDir, "annotations.json"),
    JSON.stringify({
      schema: "docsxai/annotations@1",
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
  await fs.writeFile(
    path.join(flowDir, "screenshots", "open-sidebar.png"),
    Buffer.from("\x89PNG\r\n\x1a\n-not-a-real-png-"),
  );
  await fs.writeFile(
    path.join(flowDir, "open-sidebar.md"),
    "# Open the sidebar\n\nClick the Play button.\n",
  );
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
    await expect(
      fs.access(path.join(outDir, "recap-open", "screenshots", "open-sidebar.png")),
    ).resolves.toBeUndefined();

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
        schema: "docsxai/annotations@1",
        flow: "recap-open",
        annotations: [
          {
            step: "open-sidebar",
            selector: "#a",
            bounding_box: { x: 1, y: 2, width: 3, height: 4 },
            copy: "first thing",
            index: 1,
          },
          {
            step: "open-sidebar",
            selector: "#b",
            bounding_box: { x: 5, y: 6, width: 7, height: 8 },
            copy: "second thing",
            index: 2,
          },
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

  it("the inlined overlay runtime sizes callouts via a body-attached probe two-pass (callout is detached + display:none at build time)", async () => {
    const outDir = path.join(tmp, "out-callout-width");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    // The measure MUST run on a probe attached to document.body — the callout itself is
    // inside a not-yet-attached wrap AND display:none until :hover, so measuring it in
    // place yields offsetWidth 0 → width:0px → one-character-per-line column.
    expect(flowHtml).toContain("document.body.appendChild(probe)");
    expect(flowHtml).toContain("document.body.removeChild(probe)");
    expect(flowHtml).toContain('probe.className = "sd-callout"');
    // Pass 1: natural single-line width (nowrap + wrap props neutralised), clamped to 280.
    expect(flowHtml).toContain("white-space:nowrap");
    expect(flowHtml).toContain("Math.min(probe.offsetWidth, 280)");
    // Pass 2 + final placement lock an explicit pixel width and re-enable wrapping.
    expect(flowHtml).toMatch(/white-space:normal;width:" \+ cw \+ "px/);
    // The callout must never be measured in place (the regression that baked width:0px).
    expect(flowHtml).not.toContain("Math.min(co.offsetWidth, 280)");
    // The brittle intrinsic-width approach must stay gone.
    expect(flowHtml).not.toContain("width:max-content");
  });

  it("propagates an annotation's `nudge` offset into the embedded data + viewer JS applies it to callout/arrow only", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
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

  it("inlines the overlay script from the generated bundle — the real placeCallout, not a hand-port", async () => {
    const outDir = path.join(tmp, "out-overlay-bundle");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    // The bundled placement module (placement.ts) is in the page verbatim — single-sourced.
    expect(flowHtml).toContain("function placeCallout(");
    const bundled = await fs.readFile(
      new URL("../dist/generated/overlay.js", import.meta.url),
      "utf8",
    );
    expect(flowHtml).toContain(bundled);
  });

  const EXPECTED_CSP =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">";

  it("emits the network-egress-blocking CSP meta on every flow page", async () => {
    const outDir = path.join(tmp, "out-csp");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain(EXPECTED_CSP);
  });

  it("emits the network-egress-blocking CSP meta on the index page", async () => {
    const outDir = path.join(tmp, "out-csp-index");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const indexHtml = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(indexHtml).toContain(EXPECTED_CSP);
  });

  it("renders step write-ups as markdown (not <pre>)", async () => {
    const outDir = path.join(tmp, "out-md");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain("<h1>Open the sidebar</h1>");
    expect(flowHtml).toContain("<p>Click the Play button.</p>");
    expect(flowHtml).not.toContain("<pre># Open the sidebar");
  });

  it("escapes raw HTML inside step write-up markdown (micromark safe mode)", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "open-sidebar.md"),
      "Hello <script>alert(1)</script> <img src=x onerror=y>\n",
    );
    const outDir = path.join(tmp, "out-md-safe");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).not.toContain("<script>alert(1)</script>");
    expect(flowHtml).not.toContain("<img src=x");
    expect(flowHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes HTML in annotation copy", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow: "recap-open",
        annotations: [
          { step: "open-sidebar", selector: "#play", copy: "<script>alert(1)</script> & stuff" },
        ],
      }),
    );
    const outDir = path.join(tmp, "out3");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).not.toContain("<script>alert(1)</script>");
    expect(flowHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; stuff");
  });
});
