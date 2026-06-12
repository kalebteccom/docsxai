// ADF projection — correctness against hand-written expected JSON, the markdown subset
// converter, attachment hashing, burned→clean fallback, and determinism. Pure file → JSON
// transform, so this is a unit suite (no browser, no HTTP).

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inlineMarkdownToAdf, markdownToAdf, projectDocPackToAdf } from "../src/export/adf.js";
import { main } from "../src/cli.js";

const tempDirs: string[] = [];
afterAll(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_CLEAN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Workspace with one flow (`checkout`, two steps): step-1 has md + burned png; step-2 md + clean png only. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-adf-test-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "flows"), { recursive: true });
  await fs.mkdir(path.join(dir, "docs", "checkout", "burned"), { recursive: true });
  await fs.mkdir(path.join(dir, "docs", "checkout", "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "flows", "checkout.flow.yaml"),
    [
      "name: Checkout",
      "steps:",
      "  - id: step-1",
      "    action: navigate",
      "    value: /checkout",
      "  - id: step-2",
      "    action: click",
      '    target: "[data-testid=pay]"',
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "docs", "checkout", "step-1.md"),
    "Open the **checkout** page.\n",
    "utf8",
  );
  await fs.writeFile(path.join(dir, "docs", "checkout", "step-2.md"), "Click *Pay now*.\n", "utf8");
  await fs.writeFile(path.join(dir, "docs", "checkout", "burned", "step-1.png"), PNG);
  await fs.writeFile(path.join(dir, "docs", "checkout", "screenshots", "step-2.png"), PNG_CLEAN);
  return dir;
}

describe("markdownToAdf subset converter", () => {
  it("converts paragraphs, bold, em, code, links, and lists", () => {
    const adf = markdownToAdf(
      [
        "A **bold** and *em* and `code` and [link](https://example.com) line.",
        "",
        "- first",
        "- second",
        "",
        "1. one",
        "2. two",
      ].join("\n"),
    );
    expect(adf).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A " },
          { type: "text", text: "bold", marks: [{ type: "strong" }] },
          { type: "text", text: " and " },
          { type: "text", text: "em", marks: [{ type: "em" }] },
          { type: "text", text: " and " },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: " line." },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }],
          },
        ],
      },
      {
        type: "orderedList",
        attrs: { order: 1 },
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
          },
        ],
      },
    ]);
  });

  it("keeps raw HTML as literal text (never markup)", () => {
    const adf = markdownToAdf('<script>alert("x")</script> stays text');
    expect(adf).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: '<script>alert("x")</script> stays text' }],
      },
    ]);
  });

  it("converts fenced code blocks", () => {
    const adf = markdownToAdf("```\nconst x = 1;\n```");
    expect(adf).toEqual([
      { type: "codeBlock", attrs: {}, content: [{ type: "text", text: "const x = 1;" }] },
    ]);
  });

  it("nests marks (bold inside a link)", () => {
    expect(inlineMarkdownToAdf("[**hi**](https://e.io)")).toEqual([
      {
        type: "text",
        text: "hi",
        marks: [{ type: "link", attrs: { href: "https://e.io" } }, { type: "strong" }],
      },
    ]);
  });
});

describe("projectDocPackToAdf", () => {
  it("projects a flow to the hand-written expected single-mode document", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({
      workspaceDir: dir,
      options: { title: "Shop docs" },
    });

    expect(projection.mode).toBe("single");
    expect(projection.documents).toHaveLength(1);
    const doc = projection.documents[0]!;
    expect(doc.section).toBe("project");
    expect(doc.title).toBe("Shop docs");
    expect(doc.adf).toEqual({
      version: 1,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Checkout" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "step-1" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open the " },
            { type: "text", text: "checkout", marks: [{ type: "strong" }] },
            { type: "text", text: " page." },
          ],
        },
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: { type: "file", id: "", collection: "", alt: "checkout--step-1.png" },
            },
          ],
        },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "step-2" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Click " },
            { type: "text", text: "Pay now", marks: [{ type: "em" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: { type: "file", id: "", collection: "", alt: "checkout--step-2.png" },
            },
          ],
        },
      ],
    });
  });

  it("hashes attachments (sha256 of the source bytes) and records source paths", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    const atts = projection.documents[0]!.attachments;
    expect(atts).toEqual([
      {
        fileName: "checkout--step-1.png",
        sourcePath: path.join(dir, "docs", "checkout", "burned", "step-1.png"),
        sha256: sha256(PNG),
      },
      {
        fileName: "checkout--step-2.png",
        sourcePath: path.join(dir, "docs", "checkout", "screenshots", "step-2.png"),
        sha256: sha256(PNG_CLEAN),
      },
    ]);
  });

  it("warns and falls back to the clean screenshot when the burned PNG is absent", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({ workspaceDir: dir });
    expect(projection.warnings).toEqual([
      'flow "checkout" step "step-2": burned screenshot missing — falling back to the clean screenshot',
    ]);
  });

  it("emits a parent overview + one child per flow in page-tree mode", async () => {
    const dir = await makeWorkspace();
    const projection = await projectDocPackToAdf({
      workspaceDir: dir,
      options: { mode: "page-tree", title: "Shop docs" },
    });
    expect(projection.mode).toBe("page-tree");
    expect(projection.documents.map((d) => d.section)).toEqual(["project", "checkout"]);
    expect(projection.documents[0]!.attachments).toEqual([]);
    expect(projection.documents[1]!.title).toBe("Checkout");
    expect(projection.documents[1]!.attachments).toHaveLength(2);
  });

  it("is deterministic — two projections of the same doc pack are byte-identical JSON", async () => {
    const dir = await makeWorkspace();
    const a = await projectDocPackToAdf({ workspaceDir: dir, options: { mode: "page-tree" } });
    const b = await projectDocPackToAdf({ workspaceDir: dir, options: { mode: "page-tree" } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("throws on an unknown flow name", async () => {
    const dir = await makeWorkspace();
    await expect(projectDocPackToAdf({ workspaceDir: dir, flows: ["nope"] })).rejects.toThrow(
      /no flow named "nope"/,
    );
  });
});

describe("docsxai export adf (CLI)", () => {
  it("writes projection.json + attachments.json under <workspace>/.export/adf/", async () => {
    const dir = await makeWorkspace();
    const code = await main(["export", "adf", dir, "--title", "Shop docs"]);
    expect(code).toBe(0);

    const projection = JSON.parse(
      await fs.readFile(path.join(dir, ".export", "adf", "projection.json"), "utf8"),
    );
    expect(projection.schema).toBe("docsxai/adf-projection@1");
    expect(projection.documents).toHaveLength(1);

    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, ".export", "adf", "attachments.json"), "utf8"),
    );
    expect(manifest).toEqual([
      {
        section: "project",
        fileName: "checkout--step-1.png",
        sourcePath: path.join(dir, "docs", "checkout", "burned", "step-1.png"),
        sha256: sha256(PNG),
      },
      {
        section: "project",
        fileName: "checkout--step-2.png",
        sourcePath: path.join(dir, "docs", "checkout", "screenshots", "step-2.png"),
        sha256: sha256(PNG_CLEAN),
      },
    ]);
  });
});
