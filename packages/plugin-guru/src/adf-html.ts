// ADF to HTML for Guru cards: pure and deterministic.
//
// The engine projects a doc pack to ADF only. Guru takes card content as HTML or markdown, and
// HTML gives the plugin direct control over image embedding (`<img src>` pointing at the
// Guru-hosted upload). Every text and attribute value is escaped, and a link target is kept only
// when it is http, https or mailto. Same input, same bytes: the publisher hashes the output to
// decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

/** Portable file names; an all-dot name (`.`, `..`) throws. */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name)) throw new Error(`guru: ${JSON.stringify(raw)} is not a usable name`);
  return name;
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

function block(node: AdfNode, image: ImageResolver): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.["level"] ?? 2) || 2));
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
      const alt = node.content?.[0]?.attrs?.["alt"];
      if (typeof alt !== "string") return "";
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
