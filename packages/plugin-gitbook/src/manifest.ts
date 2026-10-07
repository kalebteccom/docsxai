// Push state, stored in GitBook itself as one hidden page.
//
// GitBook pages carry no field for arbitrary data (the `description` is public SEO text), so the
// plugin keeps one page titled `docsxai manifest` next to the pages it publishes. Its body is a
// single fenced `json` block: the page id and content hash of every section. The page is hidden
// from the navigation and from search, and it is written in the same change request as the pages
// it describes, so a merge always lands the pages and their hashes together. Anything read back
// from GitBook is validated before it is trusted.

import { ID_PATTERN } from "./gitbook-client.js";

export const MANIFEST_SCHEMA = "docsxai/gitbook-manifest@1";
export const MANIFEST_TITLE = "docsxai manifest";
export const MANIFEST_SLUG = "docsxai-manifest";

/** Invalid manifest entries named in the log; the rest are counted in one line. */
const MAX_MANIFEST_WARNINGS = 20;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;

export interface PageEntry {
  pageId: string;
  sha256: string;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  pages: Record<string, PageEntry>;
}

export function emptyManifest(): Manifest {
  return { schema: MANIFEST_SCHEMA, pages: Object.create(null) as Record<string, PageEntry> };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A page entry keeps its page id whenever that is usable, so a damaged hash costs one in-place
 * update and never a second page. `ok` is false when anything was repaired.
 */
function validPage(value: unknown): { entry: PageEntry; ok: boolean } | null {
  if (!isObject(value)) return null;
  const { pageId, sha256 } = value;
  if (typeof pageId !== "string" || !ID_PATTERN.test(pageId)) return null;
  const good = typeof sha256 === "string" && SHA256_HEX.test(sha256);
  return { entry: { pageId, sha256: good ? sha256 : "" }, ok: good };
}

export function manifestToMarkdown(manifest: Manifest): string {
  const pages = Object.fromEntries(
    Object.entries(manifest.pages).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const json = JSON.stringify({ schema: manifest.schema, pages });
  return [
    "docsxai push state. Deleting or editing this page makes the next push redo the work it describes.",
    "```json",
    json,
    "```",
  ].join("\n\n");
}

/** The JSON text of the first fenced block, whatever language tag GitBook leaves on it. */
function fencedJson(markdown: string): string | null {
  const m = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(markdown);
  return m ? m[1]! : null;
}

/**
 * The manifest in a page's markdown. Content that is not a docsxai manifest throws, so a push never
 * starts over (and duplicates every page) because the state page was edited by hand. Single entries
 * that fail validation are dropped with a warning and redone.
 */
export function parseManifestMarkdown(
  markdown: string,
  warn: (message: string) => void,
  where: string,
): Manifest {
  const notManifest = () => new Error(`gitbook: ${where} is not a docsxai manifest`);
  const text = fencedJson(markdown);
  if (text === null) throw notManifest();
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
  for (const [key, value] of Object.entries(pageMap)) {
    const checked = KEY.test(key) && !/^\.+$/.test(key) ? validPage(value) : null;
    if (checked) manifest.pages[key] = checked.entry;
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
