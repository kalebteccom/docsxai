// ADF to Notion blocks: pure and deterministic.
//
// The engine projects a doc pack to ADF only. Notion takes page content as block objects, so each
// ADF node becomes headings, paragraphs, list items, code blocks or images. Notion caps one rich
// text item at 2000 characters and one rich text array at 100 items, so longer text becomes several
// items and then several blocks of the same type. A link target is kept only when it is http,
// https or mailto. Same input, same blocks: the publisher hashes them to decide whether to write.

import type { AdfDoc, AdfNode } from "@docsxai/engine";

export type NotionBlock = Record<string, unknown>;

/** Longest `content` of one rich text item. */
export const MAX_TEXT_CHARS = 2000;
/** Most rich text items in one block. */
export const MAX_RICH_ITEMS = 100;

/** Portable file names; an all-dot name (`.`, `..`) throws. */
export function safeName(raw: string): string {
  const name = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  if (/^\.+$/.test(name)) throw new Error(`notion: ${JSON.stringify(raw)} is not a usable name`);
  return name;
}

/** What an image node becomes: an uploaded file, or a note when the file cannot be uploaded. */
export type ImageSource = { fileUploadId: string } | { note: string };
/** Looks up an image by its safe file name. */
export type ImageResolver = (name: string) => ImageSource | undefined;

/** Text cut into pieces of at most {@link MAX_TEXT_CHARS}, never inside a surrogate pair. */
export function splitText(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_TEXT_CHARS, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function safeHref(href: unknown): string | null {
  const value = typeof href === "string" ? href.trim() : "";
  return /^(https?:\/\/|mailto:)/i.test(value) && value.length <= MAX_TEXT_CHARS ? value : null;
}

type RichText = Record<string, unknown>;

function richItems(nodes: AdfNode[] | undefined): RichText[] {
  return (nodes ?? []).flatMap((node) => {
    if (node.type !== "text") return richItems(node.content);
    const marks = new Set((node.marks ?? []).map((m) => m.type));
    const href = safeHref((node.marks ?? []).find((m) => m.type === "link")?.attrs?.["href"]);
    const annotations = {
      ...(marks.has("strong") ? { bold: true } : {}),
      ...(marks.has("em") ? { italic: true } : {}),
      ...(marks.has("code") ? { code: true } : {}),
    };
    return splitText(node.text ?? "").map((content) => ({
      type: "text",
      text: { content, ...(href ? { link: { url: href } } : {}) },
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    }));
  });
}

/** One block per 100 rich text items; none for empty text. */
function textBlocks(type: string, items: RichText[], extra: Record<string, unknown> = {}) {
  const blocks: NotionBlock[] = [];
  for (let i = 0; i < items.length; i += MAX_RICH_ITEMS) {
    blocks.push({ type, [type]: { rich_text: items.slice(i, i + MAX_RICH_ITEMS), ...extra } });
  }
  return blocks;
}

/** The blocks of one `code` text, split across blocks when it is longer than a block takes. */
export function codeBlocks(text: string): NotionBlock[] {
  const items: RichText[] = splitText(text).map((content) => ({ type: "text", text: { content } }));
  return textBlocks("code", items, { language: "plain text" });
}

function listItems(node: AdfNode, type: string): NotionBlock[] {
  return (node.content ?? []).flatMap((item) =>
    textBlocks(type, richItems(item.content?.[0]?.content)),
  );
}

function imageBlocks(node: AdfNode, image: ImageResolver): NotionBlock[] {
  const alt = node.content?.[0]?.attrs?.["alt"];
  if (typeof alt !== "string") return [];
  const source = image(safeName(alt));
  if (source === undefined) return [];
  if ("note" in source) return textBlocks("paragraph", richItems([textNode(source.note)]));
  return [
    {
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: source.fileUploadId },
        caption: richItems([textNode(alt)]),
      },
    },
  ];
}

function textNode(text: string): AdfNode {
  return { type: "text", text };
}

function block(node: AdfNode, image: ImageResolver): NotionBlock[] {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.["level"] ?? 2) || 2));
      return textBlocks(`heading_${level}`, richItems(node.content));
    }
    case "bulletList":
      return listItems(node, "bulleted_list_item");
    case "orderedList":
      return listItems(node, "numbered_list_item");
    case "codeBlock":
      return codeBlocks((node.content ?? []).map((n) => n.text ?? "").join(""));
    case "mediaSingle":
      return imageBlocks(node, image);
    default:
      return textBlocks("paragraph", richItems(node.content));
  }
}

export function adfToBlocks(doc: AdfDoc, image: ImageResolver): NotionBlock[] {
  return doc.content.flatMap((n) => block(n, image));
}
