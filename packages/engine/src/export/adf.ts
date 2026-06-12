// ADF (Atlassian Document Format) projection of a doc pack — pure, deterministic, zero HTTP.
//
// The engine emits projections only; all Confluence egress lives in the capability-declared
// publisher plugin (`@kalebtec/docsxai-plugin-confluence`). This module turns a workspace's
// doc pack (flow-files + step write-ups + burned screenshots) into Confluence Cloud REST v2
// `atlas_doc_format` documents plus an attachments manifest, in one of two shapes:
//
//   - `single` (default): ONE consolidated document for the whole project — every flow is an
//     anchored H2 section, every step an H3 — published as one page.
//   - `page-tree`: a parent overview document (section "project") plus one child document per
//     flow (section = flow name).
//
// Media nodes reference attachments by `alt` file name with empty `id`/`collection` — the
// publisher (or a host agent handing the projection to the Atlassian MCP) fills the file ids
// in after upload. Attachment file names are `<flow>--<step>.png`, unique per document and
// stable across modes.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FlowFile } from "../doc-pack.js";
import { parseFlowFile, resolveFlowExtends } from "../flow-file.js";
import { resolveWorkspacePath } from "../workspace.js";

// ---------------------------------------------------------------------------
// ADF node shapes (the subset this exporter emits)
// ---------------------------------------------------------------------------

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
  text?: string;
}

export interface AdfDoc {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

export type AdfExportMode = "single" | "page-tree";

export interface AdfAttachment {
  /** Unique-within-document upload name, `<flow>--<step>.png`. */
  fileName: string;
  /** Absolute path of the source PNG inside the workspace. */
  sourcePath: string;
  /** sha256 (hex) of the source bytes — the publisher's skip-unchanged key. */
  sha256: string;
}

export interface AdfDocument {
  /** Page-identity key: `project` for the consolidated/parent page, the flow name for children. */
  section: string;
  title: string;
  adf: AdfDoc;
  attachments: AdfAttachment[];
}

export interface AdfProjection {
  schema: "site-docs/adf-projection@1";
  mode: AdfExportMode;
  documents: AdfDocument[];
  warnings: string[];
}

export interface AdfExportOptions {
  mode?: AdfExportMode;
  /** Title of the consolidated page (`single`) / the parent page (`page-tree`). Default: "Site documentation". */
  title?: string;
}

// ---------------------------------------------------------------------------
// markdown → ADF (subset converter)
// ---------------------------------------------------------------------------

// Supported: paragraphs, fenced code blocks, bullet/ordered lists, `code`, **bold**, *em* /
// _em_, [links](url). Anything else — raw HTML included — stays literal text inside an ADF
// text node (ADF text is plain text, so markup can never be smuggled through).

function text(value: string, marks: AdfMark[]): AdfNode {
  return marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value };
}

/** Earliest inline token in `s`, or null. Order of tie-breaks: leftmost, then longest opener. */
function findInlineToken(
  s: string,
): {
  start: number;
  end: number;
  kind: "code" | "strong" | "em" | "link";
  inner: string;
  href?: string;
} | null {
  let best: ReturnType<typeof findInlineToken> = null;
  const consider = (m: typeof best) => {
    if (m && (best === null || m.start < best.start)) best = m;
  };

  const code = /`([^`]+)`/.exec(s);
  if (code) {
    consider({
      start: code.index,
      end: code.index + code[0].length,
      kind: "code",
      inner: code[1]!,
    });
  }
  const strong = /\*\*([^*]+)\*\*/.exec(s);
  if (strong) {
    consider({
      start: strong.index,
      end: strong.index + strong[0].length,
      kind: "strong",
      inner: strong[1]!,
    });
  }
  const em = /(^|[^*])\*([^*]+)\*/.exec(s);
  if (em) {
    const start = em.index + em[1]!.length;
    consider({ start, end: start + em[2]!.length + 2, kind: "em", inner: em[2]! });
  }
  const emU = /_([^_]+)_/.exec(s);
  if (emU) {
    consider({ start: emU.index, end: emU.index + emU[0].length, kind: "em", inner: emU[1]! });
  }
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(s);
  if (link) {
    consider({
      start: link.index,
      end: link.index + link[0].length,
      kind: "link",
      inner: link[1]!,
      href: link[2]!,
    });
  }
  return best;
}

/** Inline markdown → ADF text nodes, accumulating marks through nesting (bold inside link, …). */
export function inlineMarkdownToAdf(source: string, marks: AdfMark[] = []): AdfNode[] {
  const out: AdfNode[] = [];
  let rest = source;
  for (;;) {
    const token = findInlineToken(rest);
    if (!token) {
      if (rest.length > 0) out.push(text(rest, marks));
      return out;
    }
    if (token.start > 0) out.push(text(rest.slice(0, token.start), marks));
    if (token.kind === "code") {
      // Code spans take no nested marks — literal content.
      out.push(text(token.inner, [...marks, { type: "code" }]));
    } else if (token.kind === "link") {
      out.push(
        ...inlineMarkdownToAdf(token.inner, [
          ...marks,
          { type: "link", attrs: { href: token.href! } },
        ]),
      );
    } else {
      out.push(...inlineMarkdownToAdf(token.inner, [...marks, { type: token.kind }]));
    }
    rest = rest.slice(token.end);
  }
}

function paragraph(lines: string[]): AdfNode {
  return { type: "paragraph", content: inlineMarkdownToAdf(lines.join(" ")) };
}

function listItem(line: string): AdfNode {
  return { type: "listItem", content: [{ type: "paragraph", content: inlineMarkdownToAdf(line) }] };
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+\.\s+(.*)$/;

/** Block-level markdown (subset) → ADF block nodes. */
export function markdownToAdf(markdown: string): AdfNode[] {
  const out: AdfNode[] = [];
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      out.push({
        type: "codeBlock",
        attrs: {},
        content: code.length > 0 ? [{ type: "text", text: code.join("\n") }] : [],
      });
      continue;
    }
    if (BULLET.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) {
        items.push(listItem(BULLET.exec(lines[i]!)![1]!));
        i++;
      }
      out.push({ type: "bulletList", content: items });
      continue;
    }
    if (ORDERED.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && ORDERED.test(lines[i]!)) {
        items.push(listItem(ORDERED.exec(lines[i]!)![1]!));
        i++;
      }
      out.push({ type: "orderedList", attrs: { order: 1 }, content: items });
      continue;
    }
    // Paragraph: consume consecutive non-blank, non-list, non-fence lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !BULLET.test(lines[i]!) &&
      !ORDERED.test(lines[i]!) &&
      !lines[i]!.trimStart().startsWith("```")
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    out.push(paragraph(para));
  }
  return out;
}

// ---------------------------------------------------------------------------
// doc pack → projection
// ---------------------------------------------------------------------------

function heading(level: number, value: string): AdfNode {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text: value }] };
}

function mediaSingle(fileName: string): AdfNode {
  return {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [
      // Empty id/collection: the publisher fills these in after attachment upload, matching by `alt`.
      { type: "media", attrs: { type: "file", id: "", collection: "", alt: fileName } },
    ],
  };
}

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

interface FlowSection {
  flowName: string;
  title: string;
  /** H2 + per-step blocks — ready to embed in a single doc or wrap as its own document. */
  nodes: AdfNode[];
  attachments: AdfAttachment[];
}

async function projectFlow(
  workspaceDir: string,
  flowName: string,
  flow: FlowFile,
  warnings: string[],
): Promise<FlowSection> {
  const nodes: AdfNode[] = [heading(2, flow.name)];
  const attachments: AdfAttachment[] = [];

  for (const step of flow.steps) {
    const mdPath = resolveWorkspacePath(workspaceDir, "docs", flowName, `${step.id}.md`);
    const md = await readIfExists(mdPath);

    const burnedPath = resolveWorkspacePath(
      workspaceDir,
      "docs",
      flowName,
      "burned",
      `${step.id}.png`,
    );
    const cleanPath = resolveWorkspacePath(
      workspaceDir,
      "docs",
      flowName,
      "screenshots",
      `${step.id}.png`,
    );
    let shotPath: string | null = null;
    let shot = await readIfExists(burnedPath);
    if (shot) {
      shotPath = burnedPath;
    } else {
      shot = await readIfExists(cleanPath);
      if (shot) {
        shotPath = cleanPath;
        warnings.push(
          `flow "${flowName}" step "${step.id}": burned screenshot missing — falling back to the clean screenshot`,
        );
      }
    }

    if (md === null && shot === null) continue; // nothing documented for this step

    nodes.push(heading(3, step.id));
    if (md !== null) nodes.push(...markdownToAdf(md.toString("utf8")));
    if (shot !== null && shotPath !== null) {
      const fileName = `${flowName}--${step.id}.png`;
      attachments.push({
        fileName,
        sourcePath: shotPath,
        sha256: createHash("sha256").update(shot).digest("hex"),
      });
      nodes.push(mediaSingle(fileName));
    } else {
      warnings.push(`flow "${flowName}" step "${step.id}": no screenshot found (burned or clean)`);
    }
  }

  return { flowName, title: flow.name, nodes, attachments };
}

async function loadFlows(
  workspaceDir: string,
  only?: string[],
): Promise<Array<{ flowName: string; flow: FlowFile }>> {
  const flowsDir = resolveWorkspacePath(workspaceDir, "flows");
  const entries = await fs.readdir(flowsDir).catch(() => [] as string[]);
  const names = entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .map((e) => e.slice(0, -".flow.yaml".length))
    .sort();
  const wanted = only && only.length > 0 ? names.filter((n) => only.includes(n)) : names;
  if (only) {
    for (const o of only) {
      if (!names.includes(o)) throw new Error(`export adf: no flow named "${o}" in ${flowsDir}`);
    }
  }

  const load = async (name: string): Promise<FlowFile> => {
    const p = resolveWorkspacePath(workspaceDir, "flows", `${name}.flow.yaml`);
    return parseFlowFile(await fs.readFile(p, "utf8"), p);
  };

  const out: Array<{ flowName: string; flow: FlowFile }> = [];
  for (const name of wanted) {
    out.push({ flowName: name, flow: await resolveFlowExtends(await load(name), load) });
  }
  return out;
}

/**
 * Project a workspace's doc pack into Confluence-ready ADF documents. Pure file → JSON
 * transform: deterministic for a given doc pack, performs no HTTP, and never writes.
 */
export async function projectDocPackToAdf(opts: {
  workspaceDir: string;
  /** Restrict to these flow names (default: every `flows/*.flow.yaml`). Unknown names throw. */
  flows?: string[];
  options?: AdfExportOptions;
}): Promise<AdfProjection> {
  const mode: AdfExportMode = opts.options?.mode ?? "single";
  const title = opts.options?.title ?? "Site documentation";
  const warnings: string[] = [];

  const flows = await loadFlows(opts.workspaceDir, opts.flows);
  const sections: FlowSection[] = [];
  for (const { flowName, flow } of flows) {
    sections.push(await projectFlow(opts.workspaceDir, flowName, flow, warnings));
  }

  if (mode === "page-tree") {
    const overview: AdfDoc = {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Documentation for the flows below." }],
        },
        {
          type: "bulletList",
          content: sections.map((s) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: s.title }] }],
          })),
        },
      ],
    };
    return {
      schema: "site-docs/adf-projection@1",
      mode,
      documents: [
        { section: "project", title, adf: overview, attachments: [] },
        ...sections.map((s) => ({
          section: s.flowName,
          title: s.title,
          adf: { version: 1 as const, type: "doc" as const, content: s.nodes },
          attachments: s.attachments,
        })),
      ],
      warnings,
    };
  }

  // single: stitch every flow's section into one consolidated document.
  return {
    schema: "site-docs/adf-projection@1",
    mode,
    documents: [
      {
        section: "project",
        title,
        adf: {
          version: 1,
          type: "doc",
          content: sections.flatMap((s) => s.nodes),
        },
        attachments: sections.flatMap((s) => s.attachments),
      },
    ],
    warnings,
  };
}
