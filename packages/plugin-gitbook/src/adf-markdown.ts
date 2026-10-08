// ADF to markdown for GitBook pages: pure and deterministic.
//
// The engine projects a doc pack to ADF only. GitBook takes page content as markdown, so each
// projected document is rendered with the same subset the engine reads (paragraphs, headings,
// lists, code, bold, emphasis, links). Text is escaped so GitBook's own syntax (`{% %}` tags,
// tables, HTML) can never be smuggled in through screenshot captions or step copy, and a link is
// kept only when it is http, https or mailto, with its target percent-encoded so it cannot end the
// link early. Headings, list items, titles, alt text and log lines stay on one line. Same input,
// same bytes: the publisher hashes the output to decide whether to write.

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

/** C0 and C1 controls, DEL and the Unicode line and paragraph separators. */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/** One line: every run of control characters (newlines included) becomes a single space. */
export function singleLine(value: string): string {
  let out = "";
  let inRun = false;
  for (const char of value) {
    if (isControl(char)) {
      if (!inRun) out += " ";
      inRun = true;
    } else {
      out += char;
      inRun = false;
    }
  }
  return out;
}

/** A name from the pack as one quoted line, safe to log: a newline or control character cannot start a fake log line, and a `"` is escaped. */
export function quoted(name: string): string {
  return JSON.stringify(singleLine(name));
}

/** What starts a block at the head of a line: `#`, a bullet (`-`, `+`), a setext rule (`=`), `1.` or `1)`. */
const LINE_START = /^([ \t]*)(?:([#+=-])|(\d{1,9})([.)]))/;

/** Inline syntax as literal characters: emphasis, code, links, images, tags, tables, strikethrough. */
function escapeInline(value: string): string {
  return value.replace(/[\\`*_[\]<>{}|~]/g, (c) => `\\${c}`);
}

/**
 * Text as literal markdown: inline syntax is escaped everywhere, and the one character that would
 * open a block (heading, list, thematic break or setext underline) is escaped at the head of each
 * line, so a line of step copy cannot turn into structure.
 */
function escapeText(value: string): string {
  return escapeInline(value.replace(/\r\n?/g, "\n"))
    .split("\n")
    .map((line) =>
      line.replace(LINE_START, (_, indent: string, mark?: string, digits?: string, dot?: string) =>
        mark ? `${indent}\\${mark}` : `${indent}${digits}\\${dot}`,
      ),
    )
    .join("\n");
}

function percentEncode(char: string): string {
  return [...Buffer.from(char, "utf8")]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

/**
 * A link target kept only for http, https and mailto. Whitespace, controls, brackets, parentheses,
 * angle brackets, quotes, backticks and backslashes are percent-encoded so the target cannot end
 * the link early; anything else is dropped to plain text by the caller.
 */
function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) return null;
  return Array.from(trimmed, (char) =>
    isControl(char) || /[\s()<>[\]\\`"]/.test(char) ? percentEncode(char) : char,
  ).join("");
}

/** A fence or span of backticks one longer than the longest run inside `text`. */
function ticks(text: string, least: number): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(least, longest + 1));
}

/**
 * A code span on one line. A backtick at either end, or a space at both ends, gets a space of
 * padding on each side: markdown strips one such pair, so the content is read back as written.
 */
function codeSpan(text: string): string {
  const flat = text.replace(/\r\n?|\n/g, " ");
  if (flat === "") return "";
  const fence = ticks(flat, 1);
  const edge = flat.startsWith("`") || flat.endsWith("`");
  const spaced = flat.startsWith(" ") && flat.endsWith(" ") && flat.trim() !== "";
  const pad = edge || spaced ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * Inline nodes joined in order. A `!` that ends one node and sits right before a link (the next
 * output that starts with a bare `[`, since text escapes its own brackets) would read as `![t](url)`,
 * an image the viewer loads on sight, so that `!` is escaped.
 */
function inline(nodes: AdfNode[] | undefined): string {
  const parts = (nodes ?? []).map(inlineNode);
  return parts
    .map((part, i) => {
      if (!part.endsWith("!")) return part;
      const next = parts.slice(i + 1).find((p) => p !== "");
      return next?.startsWith("[") ? `${part.slice(0, -1)}\\!` : part;
    })
    .join("");
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

/** Inline content on one line, for headings and list items. */
function inlineLine(nodes: AdfNode[] | undefined): string {
  return inline(nodes).replace(/\s*\n\s*/g, " ");
}

function listItems(node: AdfNode, ordered: boolean): string {
  return (node.content ?? [])
    .map((item, i) => `${ordered ? `${i + 1}.` : "-"} ${inlineLine(item.content?.[0]?.content)}`)
    .join("\n");
}

function block(node: AdfNode, image: ImageResolver): string {
  switch (node.type) {
    case "heading": {
      const asked = Number(node.attrs?.["level"] ?? 2);
      const level = Number.isNaN(asked) ? 2 : Math.min(6, Math.max(1, Math.trunc(asked)));
      return `${"#".repeat(level)} ${inlineLine(node.content)}`;
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
      const text = escapeInline(singleLine(alt));
      const target = image(safeName(alt));
      return target ? `![${text}](${target})` : `*Screenshot not uploaded: ${text}*`;
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
 * has one source for it. A JSON string is a valid YAML double-quoted scalar, and the title is cut
 * to one line first because YAML also reads U+0085, U+2028 and U+2029 as line breaks.
 */
export function withTitle(title: string, body: string): string {
  return `---\ntitle: ${JSON.stringify(singleLine(title).trim())}\n---\n\n${body}\n`;
}
