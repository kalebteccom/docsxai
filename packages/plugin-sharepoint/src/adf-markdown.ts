// ADF to markdown: the inverse of the engine's subset converter, pure and deterministic.
//
// The engine projects a doc pack to ADF only. SharePoint document libraries take plain files,
// so this module renders each projected document as GitHub-flavoured markdown. Media nodes
// become relative image links into the `images/` folder the publisher uploads next to the
// page. Same input, same bytes: the publisher hashes the output to decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

export const IMAGES_DIR = "images";

/**
 * SharePoint rejects `" * : < > ? / \ |` and strips a trailing dot, so `a.` and `a` are one file.
 * Keep to a conservative portable set and drop trailing dots here, so two names SharePoint would
 * merge come out as the same string and the publisher's collision check sees them.
 */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name))
    throw new Error(`sharepoint: ${JSON.stringify(raw)} is not a usable file name`);
  return name.replace(/[.-]+$/, "");
}

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

/** What starts a block at the head of a line: `#`, a bullet (`-`, `+`), a setext rule (`=`), `1.` or `1)`. */
const LINE_START = /^([ \t]*)(?:([#+=-])|(\d{1,9})([.)]))/;

/** Inline syntax as literal characters: emphasis, code, links, images, HTML, tables, strikethrough. */
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

/** The `# ` line that opens a page: the title as one escaped line. */
export function titleLine(title: string): string {
  return `# ${escapeText(singleLine(title).trim())}`;
}

/**
 * A link target kept only for http, https and mailto. Whitespace, controls, brackets, parentheses,
 * angle brackets, quotes, backticks and backslashes are percent-encoded so the target cannot end
 * the link early; anything else is dropped to plain text by the caller.
 */
function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return null;
  return Array.from(trimmed, (char) =>
    isControl(char) || /[\s()<>[\]\\`"]/.test(char) ? percentEncode(char) : char,
  ).join("");
}

function percentEncode(char: string): string {
  return [...Buffer.from(char, "utf8")]
    .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
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

/** Library-relative path of images, keyed by the `alt` that names them. */
export type ImagePaths = ReadonlyMap<string, string>;

/** The `alt` of an image block, which the engine's projection sets to the attachment file name. */
function imageAlt(node: AdfNode): string | undefined {
  const alt = node.content?.[0]?.attrs?.["alt"];
  return node.type === "mediaSingle" && typeof alt === "string" ? alt : undefined;
}

/** Every image a document links, by `alt`, so a publisher can check them before it writes anything. */
export function imageAlts(doc: AdfDoc): string[] {
  return doc.content.flatMap((node) => imageAlt(node) ?? []);
}

function block(node: AdfNode, images: ImagePaths | undefined): string {
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
      const alt = imageAlt(node);
      return alt === undefined
        ? ""
        : `![${escapeInline(singleLine(alt))}](${images?.get(alt) ?? `${IMAGES_DIR}/${safeName(alt)}`})`;
    }
    default:
      return inline(node.content);
  }
}

/**
 * `images` maps an image's `alt` to the path its file is uploaded to, so link and upload share one
 * name. An `alt` it does not list links to its own safe name.
 */
export function adfToMarkdown(doc: AdfDoc, images?: ImagePaths): string {
  return doc.content
    .map((node) => block(node, images))
    .filter((s) => s.length > 0)
    .join("\n\n");
}
