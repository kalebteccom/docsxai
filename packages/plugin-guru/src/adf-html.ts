// ADF to HTML for Guru cards: pure and deterministic.
//
// The engine projects a doc pack to ADF only. Guru takes card content as HTML or markdown, and
// HTML gives the plugin direct control over image embedding (`<img src>` pointing at the
// Guru-hosted upload). Every text and attribute value is escaped, a heading level is held to 1..6,
// and a link target is kept only when it is http, https or mailto. Same input, same bytes: the publisher hashes the output to
// decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

/** Portable file names; an all-dot name (`.`, `..`) throws. */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name)) throw new Error(`guru: ${JSON.stringify(raw)} is not a usable name`);
  return name;
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

/** A name from the pack as one quoted line, safe to log: a newline or control character cannot start a fake log line, and a `"` is escaped. */
export function quoted(name: string): string {
  return JSON.stringify(singleLine(name));
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

/** Looks up the Guru-hosted URL of an uploaded image by its safe file name. */
export type ImageResolver = (name: string) => string | undefined;

function safeHref(href: unknown): string | null {
  return typeof href === "string" && /^(https?:\/\/|mailto:)/i.test(href.trim())
    ? href.trim()
    : null;
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  if (node.type !== "text") return inline(node.content);
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  const raw = escapeHtml(node.text ?? "");
  let out = marks.has("code") ? `<code>${raw}</code>` : raw;
  if (marks.has("em")) out = `<em>${out}</em>`;
  if (marks.has("strong")) out = `<strong>${out}</strong>`;
  const link = (node.marks ?? []).find((m) => m.type === "link");
  const href = safeHref(link?.attrs?.["href"]);
  return href ? `<a href="${escapeHtml(href)}">${out}</a>` : out;
}

function listItems(node: AdfNode): string {
  return (node.content ?? [])
    .map((item) => `<li>${inline(item.content?.[0]?.content)}</li>`)
    .join("");
}

/** The `alt` of an image block, which the engine's projection sets to the attachment file name. */
function imageAlt(node: AdfNode): string | undefined {
  const alt = node.content?.[0]?.attrs?.["alt"];
  return node.type === "mediaSingle" && typeof alt === "string" ? alt : undefined;
}

/** Every image a document links, by `alt`, so a publisher can check them before it writes anything. */
export function imageAlts(doc: AdfDoc): string[] {
  return doc.content.flatMap((node) => imageAlt(node) ?? []);
}

function block(node: AdfNode, image: ImageResolver): string {
  switch (node.type) {
    case "heading": {
      const asked = Number(node.attrs?.["level"] ?? 2);
      const level = Number.isNaN(asked) ? 2 : Math.min(6, Math.max(1, Math.trunc(asked)));
      return `<h${level}>${inline(node.content)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${listItems(node)}</ul>`;
    case "orderedList":
      return `<ol>${listItems(node)}</ol>`;
    case "codeBlock": {
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return `<pre><code>${escapeHtml(code)}</code></pre>`;
    }
    case "mediaSingle": {
      const alt = imageAlt(node);
      if (alt === undefined) return "";
      const src = image(safeName(alt));
      return src ? `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></p>` : "";
    }
    default: {
      const text = inline(node.content);
      return text.length > 0 ? `<p>${text}</p>` : "";
    }
  }
}

export function adfToHtml(doc: AdfDoc, image: ImageResolver): string {
  return doc.content
    .map((n) => block(n, image))
    .filter((s) => s.length > 0)
    .join("\n");
}
