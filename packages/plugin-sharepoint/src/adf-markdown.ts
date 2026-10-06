// ADF to markdown: the inverse of the engine's subset converter, pure and deterministic.
//
// The engine projects a doc pack to ADF only. SharePoint document libraries take plain files,
// so this module renders each projected document as GitHub-flavoured markdown. Media nodes
// become relative image links into the `images/` folder the publisher uploads next to the
// page. Same input, same bytes: the publisher hashes the output to decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

export const IMAGES_DIR = "images";

/** SharePoint rejects `" * : < > ? / \ |`; keep to a conservative portable set. */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name))
    throw new Error(`sharepoint: ${JSON.stringify(raw)} is not a usable file name`);
  return name;
}

function escapeText(value: string): string {
  return value.replace(/[\\`*_[\]<]/g, (c) => `\\${c}`);
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  if (node.type !== "text") return inline(node.content);
  const marks = new Set((node.marks ?? []).map((m) => m.type));
  const raw = node.text ?? "";
  let out = marks.has("code") ? `\`${raw}\`` : escapeText(raw);
  if (marks.has("em")) out = `*${out}*`;
  if (marks.has("strong")) out = `**${out}**`;
  const link = (node.marks ?? []).find((m) => m.type === "link");
  const href = link?.attrs?.["href"];
  return typeof href === "string" ? `[${out}](${href})` : out;
}

function listItems(node: AdfNode, ordered: boolean): string {
  return (node.content ?? [])
    .map((item, i) => `${ordered ? `${i + 1}.` : "-"} ${inline(item.content?.[0]?.content)}`)
    .join("\n");
}

function block(node: AdfNode): string {
  switch (node.type) {
    case "heading":
      return `${"#".repeat(Number(node.attrs?.["level"] ?? 2))} ${inline(node.content)}`;
    case "bulletList":
      return listItems(node, false);
    case "orderedList":
      return listItems(node, true);
    case "codeBlock":
      return `\`\`\`\n${(node.content ?? []).map((n) => n.text ?? "").join("")}\n\`\`\``;
    case "mediaSingle": {
      const alt = node.content?.[0]?.attrs?.["alt"];
      return typeof alt === "string" ? `![${alt}](${IMAGES_DIR}/${safeName(alt)})` : "";
    }
    default:
      return inline(node.content);
  }
}

export function adfToMarkdown(doc: AdfDoc): string {
  return doc.content
    .map(block)
    .filter((s) => s.length > 0)
    .join("\n\n");
}
