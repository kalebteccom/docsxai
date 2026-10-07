// ADF to markdown for GitBook pages: pure and deterministic.
//
// The engine projects a doc pack to ADF only. GitBook takes page content as markdown, so each
// projected document is rendered with the same subset the engine reads (paragraphs, headings,
// lists, code, bold, emphasis, links). Text is escaped so GitBook's own syntax (`{% %}` tags,
// tables, HTML) can never be smuggled in through screenshot captions or step copy, and a link is
// kept only when it is http, https or mailto. Same input, same bytes: the publisher hashes the
// output to decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

/** Portable file names; an all-dot name (`.`, `..`) throws. */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name)) throw new Error(`gitbook: ${JSON.stringify(raw)} is not a usable name`);
  return name;
}

/** Page slugs: lower case letters, digits and hyphens, at most 100 characters. */
export function pageSlug(key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "page";
}

/** Resolves an uploaded image, by its safe file name, to the link target the page should use. */
export type ImageResolver = (name: string) => string | undefined;

/** What starts a block at the head of a line: `#`, a bullet (`-`, `+`), a setext rule (`=`), `1.` or `1)`. */
const LINE_START = /^([ \t]*)(?:([#+=-])|(\d{1,9})([.)]))/;

/**
 * Text as literal markdown: inline syntax is escaped everywhere, and the one character that would
 * open a block (heading, list, thematic break or setext underline) is escaped at the head of each
 * line, so a line of step copy cannot turn into structure.
 */
function escapeText(value: string): string {
  return value
    .replace(/[\\`*_[\]<>{}|~]/g, (c) => `\\${c}`)
    .split("\n")
    .map((line) =>
      line.replace(LINE_START, (_, indent: string, mark?: string, digits?: string, dot?: string) =>
        mark ? `${indent}\\${mark}` : `${indent}${digits}\\${dot}`,
      ),
    )
    .join("\n");
}

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) && !/[\s()<>]/.test(trimmed) ? trimmed : null;
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  if (node.type !== "text") return inline(node.content);
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  const raw = node.text ?? "";
  let out = marks.has("code") ? codeSpan(raw) : escapeText(raw);
  if (marks.has("em")) out = `*${out}*`;
  if (marks.has("strong")) out = `**${out}**`;
  const href = safeHref((node.marks ?? []).find((m) => m.type === "link")?.attrs?.["href"]);
  return href ? `[${out}](${href})` : out;
}

/** A fence or span of backticks one longer than the longest run inside `text`. */
function ticks(text: string, least: number): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(least, longest + 1));
}

function codeSpan(text: string): string {
  const fence = ticks(text, 1);
  return `${fence}${text}${fence}`;
}

function listItems(node: AdfNode, ordered: boolean): string {
  return (node.content ?? [])
    .map((item, i) => `${ordered ? `${i + 1}.` : "-"} ${inline(item.content?.[0]?.content)}`)
    .join("\n");
}

function block(node: AdfNode, image: ImageResolver): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.["level"] ?? 2) || 2));
      return `${"#".repeat(level)} ${inline(node.content)}`;
    }
    case "bulletList":
      return listItems(node, false);
    case "orderedList":
      return listItems(node, true);
    case "codeBlock": {
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      const fence = ticks(code, 3);
      return `${fence}\n${code}\n${fence}`;
    }
    case "mediaSingle": {
      const alt = node.content?.[0]?.attrs?.["alt"];
      if (typeof alt !== "string") return "";
      const target = image(safeName(alt));
      return target
        ? `![${escapeText(alt)}](${target})`
        : `*Screenshot not uploaded: ${escapeText(alt)}*`;
    }
    default:
      return inline(node.content);
  }
}

export function adfToMarkdown(doc: AdfDoc, image: ImageResolver): string {
  return doc.content
    .map((n) => block(n, image))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * A page body with its title in YAML frontmatter. GitBook documents that frontmatter and a leading
 * heading win over the `title` field of a change, so the title goes in frontmatter and the page
 * has one source for it. A JSON string is a valid YAML double-quoted scalar.
 */
export function withTitle(title: string, body: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}\n`;
}
