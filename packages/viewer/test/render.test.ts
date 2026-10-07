import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViewer, parseAnnotations, pngSize } from "../src/render.js";
import { solidPng } from "./helpers/png.js";

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
    expect(indexHtml).toContain('href="./recap-open/index.html"');
  });

  it("renders the same pack to byte-identical pages", async () => {
    const docsDir = path.join(tmp, "docs");
    const pages = ["index.html", "recap-open/index.html"];
    await buildViewer({ docsDir, outDir: path.join(tmp, "out-a") });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await buildViewer({ docsDir, outDir: path.join(tmp, "out-b") });
    for (const page of pages) {
      const a = await fs.readFile(path.join(tmp, "out-a", page), "utf8");
      const b = await fs.readFile(path.join(tmp, "out-b", page), "utf8");
      expect(b).toBe(a);
      expect(a).toMatch(/Rendered by @docsxai\/viewer [^<.]+\./);
    }
  });

  it("links each flow page to its neighbours in flow order and inlines the runtime on the index", async () => {
    const second = path.join(tmp, "docs", "zz-settings");
    await fs.mkdir(second, { recursive: true });
    await fs.writeFile(
      path.join(second, "annotations.json"),
      JSON.stringify({ schema: "docsxai/annotations@1", flow: "zz-settings", annotations: [] }),
    );
    const outDir = path.join(tmp, "out-neighbours");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const first = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    const last = await fs.readFile(path.join(outDir, "zz-settings", "index.html"), "utf8");
    expect(first).toContain('<a rel="next" href="../zz-settings/index.html">');
    expect(first).not.toContain('rel="prev"');
    expect(last).toContain('<a rel="prev" href="../recap-open/index.html">');
    expect(last).not.toContain('rel="next"');
    const index = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).toContain("function keyAction(");
  });

  it("leaves out a step id that would reach outside the pack and says so on the page", async () => {
    const docs = path.join(tmp, "docs");
    await fs.writeFile(path.join(docs, "secret.png"), Buffer.from("\x89PNG\r\n\x1a\n-outside-"));
    await fs.writeFile(path.join(docs, "secret.md"), "TOPSECRET\n");
    const flowDir = path.join(docs, "recap-open");
    const rec = (step: string) => ({ step, selector: "#a", copy: `copy for ${step}` });
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow: "recap-open",
        annotations: [
          rec("open-sidebar"),
          rec("../../secret"),
          rec("a/b"),
          rec("c\\d"),
          rec("x:y"),
          rec("e\u001bf"),
        ],
      }),
    );
    const outDir = path.join(tmp, "out-unsafe-steps");
    const r = await buildViewer({ docsDir: docs, outDir });
    expect(r.warnings).toHaveLength(5);
    expect(r.warnings[0]).toBe(
      'recap-open: step "../../secret" skipped: a step id cannot hold "/", "\\", "..", ":" or control characters',
    );
    expect(r.warnings[4]).toContain('step "e\\u001bf" skipped');
    const html = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(html).toContain('src="screenshots/open-sidebar.png"');
    expect(html.match(/cannot be used as a file name/g)).toHaveLength(5);
    expect(html).not.toContain("TOPSECRET");
    expect(html).not.toContain("secret.png");
    expect(html).not.toContain("copy for ../../secret");
    await expect(fs.access(path.join(outDir, "secret.png"))).rejects.toThrow();
    await expect(fs.access(path.join(outDir, "recap-open", "secret.png"))).rejects.toThrow();
  });

  it("skips a flow whose name is not a plain path, with a warning, and links the others from ./", async () => {
    const docs = path.join(tmp, "docs");
    const evil = path.join(docs, "javascript:alert(1)");
    await fs.mkdir(evil, { recursive: true });
    await fs.writeFile(
      path.join(evil, "annotations.json"),
      JSON.stringify({ schema: "docsxai/annotations@1", flow: "x", annotations: [] }),
    );
    const outDir = path.join(tmp, "out-unsafe-flow");
    const r = await buildViewer({ docsDir: docs, outDir });
    expect(r.pages).toEqual(["index.html", "recap-open/index.html"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('flow "javascript:alert(1)" skipped');
    const index = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).not.toContain("javascript:");
    expect(index).toContain('href="./recap-open/index.html"');

    const explicit = await buildViewer({
      docsDir: docs,
      outDir: path.join(tmp, "out-explicit"),
      flows: ["recap-open", "../evil", "a\\b", "x/y/z", ""],
    });
    expect(explicit.pages).toEqual(["index.html", "recap-open/index.html"]);
    expect(explicit.warnings).toHaveLength(4);
    await expect(fs.access(path.join(tmp, "evil"))).rejects.toThrow();
  });

  it("produces an (empty) index when there are no flows", async () => {
    const outDir = path.join(tmp, "out2");
    const r = await buildViewer({ docsDir: path.join(tmp, "nonexistent-docs"), outDir });
    expect(r.pages).toEqual(["index.html"]);
    expect(await fs.readFile(path.join(outDir, "index.html"), "utf8")).toContain("No flows yet");
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
    // Pass 1: natural single-line width (nowrap + wrap props neutralised), clamped to 280 or to
    // the image width on a narrower image.
    expect(flowHtml).toContain("white-space:nowrap");
    expect(flowHtml).toContain("Math.min(probe.offsetWidth, maxWidth)");
    expect(flowHtml).toContain("measureCallout(label, Math.min(280, im.width))");
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

  it("the inlined runtime redraws overlays when the displayed image width changes", async () => {
    const outDir = path.join(tmp, "out-resize");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('window.addEventListener("resize", onResize)');
    // closed write-ups open for printing and close again after
    expect(flowHtml).toContain('window.addEventListener("beforeprint", onBeforePrint)');
    expect(flowHtml).toContain('window.addEventListener("afterprint", onAfterPrint)');
    expect(flowHtml).toContain("shot.dataset.drawnWidth");
  });

  it("the inlined runtime makes a call-out a labelled button and hides the duplicate nodes from AT", async () => {
    const outDir = path.join(tmp, "out-a11y-runtime");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('document.createElement("button")');
    expect(flowHtml).toContain('halo.setAttribute("aria-label", label)');
    expect(flowHtml).toContain('badge.setAttribute("aria-hidden", "true")');
    expect(flowHtml).toContain('co.setAttribute("aria-hidden", "true")');
    expect(flowHtml).toContain("function dismissOpen(");
    // the native tooltip duplicated the callout text on hover
    expect(flowHtml).not.toContain("halo.title");
  });

  it("reads the screenshot size from the PNG header into width/height", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(path.join(flowDir, "screenshots", "open-sidebar.png"), solidPng(40, 25));
    expect(await pngSize(path.join(flowDir, "screenshots", "open-sidebar.png"))).toEqual({
      width: 40,
      height: 25,
    });
    const outDir = path.join(tmp, "out-size");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('width="40" height="25"');
  });

  it("pngSize returns null for a non-PNG, a short file and a missing file", async () => {
    const dir = path.join(tmp, "docs", "recap-open", "screenshots");
    await fs.writeFile(path.join(dir, "fake.png"), Buffer.alloc(40, 1));
    await fs.writeFile(path.join(dir, "short.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await pngSize(path.join(dir, "fake.png"))).toBeNull();
    expect(await pngSize(path.join(dir, "short.png"))).toBeNull();
    expect(await pngSize(path.join(dir, "missing.png"))).toBeNull();
    // the fixture's stand-in bytes are not a PNG either: no size, no crash
    expect(await pngSize(path.join(dir, "open-sidebar.png"))).toBeNull();
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
    // demoted two levels: the write-up sits under the step's <h2>
    expect(flowHtml).toContain("<h3>Open the sidebar</h3>");
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

  it("falls back to the screenshots and says why when annotations.json is not JSON", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.writeFile(path.join(flowDir, "annotations.json"), "{ not json");
    const outDir = path.join(tmp, "out-broken");
    const r = await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    expect(r.pages).toEqual(["index.html", "recap-open/index.html"]);
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain('<p class="notice">annotations.json could not be parsed');
    expect(flowHtml).toContain('src="screenshots/open-sidebar.png"');
    expect(flowHtml).not.toContain("data-anns=");
  });

  it("renders a step whose screenshot is missing instead of failing", async () => {
    const flowDir = path.join(tmp, "docs", "recap-open");
    await fs.rm(path.join(flowDir, "screenshots", "open-sidebar.png"));
    const outDir = path.join(tmp, "out-missing-shot");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir });
    const flowHtml = await fs.readFile(path.join(outDir, "recap-open", "index.html"), "utf8");
    expect(flowHtml).toContain("No screenshot was captured for this step.");
    expect(flowHtml).toContain("Click Play to open the recap sidebar");
    const index = await fs.readFile(path.join(outDir, "index.html"), "utf8");
    expect(index).toContain('<div class="thumb-missing">No screenshot</div>');
  });
});

describe("parseAnnotations", () => {
  const rec = { step: "s", selector: "#a", copy: "c" };

  it("returns nothing and no notice for an absent file", () => {
    expect(parseAnnotations(null)).toEqual({ records: [], notices: [] });
  });

  it("keeps a well-formed file as is", () => {
    const text = JSON.stringify({ schema: "docsxai/annotations@1", flow: "f", annotations: [rec] });
    expect(parseAnnotations(text)).toEqual({ records: [rec], notices: [] });
  });

  it("reports a file that is not JSON or has no annotations list", () => {
    expect(parseAnnotations("{").notices[0]).toMatch(/could not be parsed/);
    expect(parseAnnotations("null").notices[0]).toMatch(/no annotations list/);
    expect(parseAnnotations('{"annotations":{}}').notices[0]).toMatch(/no annotations list/);
  });

  it("skips malformed records and counts them", () => {
    const text = JSON.stringify({
      annotations: [rec, null, { step: "", copy: "x" }, { step: "s" }, { step: 3, copy: "x" }],
    });
    const r = parseAnnotations(text);
    expect(r.records).toEqual([rec]);
    expect(r.notices).toEqual([
      "4 annotation records were skipped: each needs a step name and copy text.",
    ]);
    const one = parseAnnotations(JSON.stringify({ annotations: [rec, {}] }));
    expect(one.notices[0]).toMatch(/^1 annotation record was skipped/);
  });
});
