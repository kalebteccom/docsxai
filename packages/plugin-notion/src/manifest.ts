// Push state, stored in Notion itself as one page.
//
// A Notion page created through the API has no custom property to hold data (a page under a page
// has only its title), so the plugin keeps one page, titled `docsxai manifest`, next to the pages
// it publishes. Its body is code blocks holding compact JSON: the page id and content hash of
// every published page. Anything read back from Notion is validated before it is trusted.

import { isNotionUrl, normalizeId } from "./notion-client.js";
import { codeBlocks, type NotionBlock } from "./notion-blocks.js";

export const MANIFEST_SCHEMA = "docsxai/notion-manifest@1";
export const MANIFEST_TITLE = "docsxai manifest";

/** Invalid manifest entries named in the log; the rest are counted in one line. */
const MAX_MANIFEST_WARNINGS = 20;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;

export interface PageEntry {
  pageId: string;
  /** Hash of what was last written, or "" while a write was in progress or failed. */
  sha256: string;
  url?: string;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  pages: Record<string, PageEntry>;
}

const nullMap = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export function emptyManifest(): Manifest {
  return { schema: MANIFEST_SCHEMA, pages: nullMap() };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A page entry keeps its page id whenever that is usable, so a damaged hash or URL costs one
 * in-place rewrite and never a second page. `ok` is false when anything was repaired. An empty
 * hash is the "redo me" marker the publisher leaves, and is not damage.
 */
function validPage(value: unknown): { entry: PageEntry; ok: boolean } | null {
  if (!isObject(value)) return null;
  const pageId = normalizeId(value["pageId"]);
  if (pageId === null) return null;
  const { sha256, url } = value;
  const goodSha = typeof sha256 === "string" && (sha256 === "" || SHA256_HEX.test(sha256));
  return {
    entry: {
      pageId,
      sha256: typeof sha256 === "string" && goodSha ? sha256 : "",
      ...(isNotionUrl(url) ? { url } : {}),
    },
    ok: goodSha && (url === undefined || isNotionUrl(url)),
  };
}

function sortedPages(manifest: Manifest): Record<string, PageEntry> {
  return Object.fromEntries(Object.entries(manifest.pages).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The blocks of the manifest page: a short note, then the JSON in code blocks. */
export function manifestBlocks(manifest: Manifest): NotionBlock[] {
  const json = JSON.stringify({ schema: manifest.schema, pages: sortedPages(manifest) });
  const note =
    "docsxai push state. Deleting or editing this page makes the next push redo the work it describes.";
  return [
    { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: note } }] } },
    ...codeBlocks(json),
  ];
}

/**
 * The manifest in the text of a page's code blocks. Content that is not a docsxai manifest throws,
 * so a push never starts over (and duplicates every page) because the state page was edited by
 * hand. Single entries that fail validation are dropped with a warning and redone.
 */
export function parseManifestText(
  text: string,
  warn: (message: string) => void,
  where: string,
): Manifest {
  const notManifest = () => new Error(`notion: ${where} is not a docsxai manifest`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notManifest();
  }
  if (!isObject(parsed) || parsed["schema"] !== MANIFEST_SCHEMA) throw notManifest();
  const pageMap = parsed["pages"];
  if (!isObject(pageMap)) throw notManifest();
  const manifest = emptyManifest();
  let dropped = 0;
  // Two keys naming one page would rewrite it twice with different content, so the later key is
  // dropped and gets a page of its own.
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(pageMap)) {
    let checked = KEY.test(key) && !/^\.+$/.test(key) ? validPage(value) : null;
    if (checked && seen.has(checked.entry.pageId)) checked = null;
    if (checked) {
      seen.add(checked.entry.pageId);
      manifest.pages[key] = checked.entry;
    }
    if (checked?.ok) continue;
    dropped++;
    if (dropped <= MAX_MANIFEST_WARNINGS) {
      warn(`manifest entry ${JSON.stringify(key.slice(0, 80))} is not valid, redoing it`);
    }
  }
  if (dropped > MAX_MANIFEST_WARNINGS) {
    warn(`${dropped - MAX_MANIFEST_WARNINGS} more manifest entries are not valid, redoing them`);
  }
  return manifest;
}
