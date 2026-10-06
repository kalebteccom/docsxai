// Push state, stored in Guru itself as one card.
//
// Guru has no per-card field the public API documents for arbitrary data, and a tag needs a
// tag category and an id before a card can carry it. So the plugin keeps one manifest card, titled
// `docsxai manifest`, in the target collection. Its body is a single `<pre>` block with compact
// JSON: the card id and content hash of every page, and the hash and Guru-hosted URL of every
// uploaded image. Anything read back from Guru is validated before it is trusted.

import { ID_PATTERN, isAttachmentUrl } from "./guru-client.js";
import { escapeHtml } from "./adf-html.js";

export const MANIFEST_SCHEMA = "docsxai/guru-manifest@1";
export const MANIFEST_TITLE = "docsxai manifest";

/** Invalid manifest entries named in the log; the rest are counted in one line. */
const MAX_MANIFEST_WARNINGS = 20;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const SLUG = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export interface PageEntry {
  cardId: string;
  sha256: string;
  url?: string;
}

export interface ImageEntry {
  sha256: string;
  size: number;
  link: string;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  pages: Record<string, PageEntry>;
  images: Record<string, ImageEntry>;
}

const nullMap = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export function emptyManifest(): Manifest {
  return { schema: MANIFEST_SCHEMA, pages: nullMap(), images: nullMap() };
}

/** True for an `https:` URL on Guru's app host, with no credentials or port. */
export function isGuruCardUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "app.getguru.com" &&
      !url.username &&
      !url.password &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

/** The web URL of a card from its `slug`, or undefined when the slug has anything unexpected in it. */
export function cardUrl(slug: string | undefined): string | undefined {
  return slug !== undefined && slug.length <= 256 && SLUG.test(slug)
    ? `https://app.getguru.com/card/${slug}`
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validKey(key: string): boolean {
  return KEY.test(key) && !/^\.+$/.test(key);
}

/**
 * A page entry keeps its card id whenever that is usable, so a damaged hash or URL costs one
 * in-place update and never a second card. `ok` is false when anything was repaired.
 */
function validPage(value: unknown): { entry: PageEntry; ok: boolean } | null {
  if (!isObject(value)) return null;
  const { cardId, sha256, url } = value;
  if (typeof cardId !== "string" || !ID_PATTERN.test(cardId)) return null;
  const goodSha = typeof sha256 === "string" && SHA256_HEX.test(sha256);
  return {
    entry: {
      cardId,
      sha256: typeof sha256 === "string" && goodSha ? sha256 : "",
      ...(isGuruCardUrl(url) ? { url } : {}),
    },
    ok: goodSha && (url === undefined || isGuruCardUrl(url)),
  };
}

function validImage(value: unknown): { entry: ImageEntry; ok: boolean } | null {
  if (!isObject(value)) return null;
  const { sha256, size, link } = value;
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
  if (!isAttachmentUrl(link)) return null;
  return { entry: { sha256, size, link }, ok: true };
}

function sorted<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function manifestToHtml(manifest: Manifest): string {
  const json = JSON.stringify({
    schema: manifest.schema,
    pages: sorted(manifest.pages),
    images: sorted(manifest.images),
  });
  return [
    "<p>docsxai push state. Deleting or editing this card makes the next push redo the work it describes.</p>",
    `<pre>${escapeHtml(json)}</pre>`,
  ].join("\n");
}

const NAMED: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes the entities an HTML sanitiser may rewrite a quote or bracket into. `&amp;` is last. */
function decodeEntities(text: string): string {
  const point = (cp: number) => (cp <= 0x10ffff ? String.fromCodePoint(cp) : "");
  return text
    .replace(/&(nbsp|lt|gt|quot|apos);/g, (_, name: string) => NAMED[name]!)
    .replace(/&#(\d{1,7});/g, (_, dec: string) => point(Number(dec)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => point(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

/** The JSON text inside the first `<pre>` block, with tags removed and entities decoded. */
function preText(html: string): string | null {
  const m = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  if (!m) return null;
  return decodeEntities(m[1]!.replace(/<[^>]*>/g, ""));
}

/**
 * The manifest in a card's content. Content that is not a docsxai manifest throws, so a push never
 * starts over (and duplicates every card) because the state card was edited by hand. Single entries
 * that fail validation are dropped with a warning and redone.
 */
export function parseManifestHtml(
  html: string,
  warn: (message: string) => void,
  where: string,
): Manifest {
  const notManifest = () => new Error(`guru: ${where} is not a docsxai manifest`);
  const text = preText(html);
  if (text === null) throw notManifest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notManifest();
  }
  if (!isObject(parsed) || parsed["schema"] !== MANIFEST_SCHEMA) throw notManifest();
  const pageMap = parsed["pages"];
  const imageMap = parsed["images"];
  if (!isObject(pageMap) || !isObject(imageMap)) throw notManifest();
  const manifest = emptyManifest();
  let dropped = 0;
  const take = <T>(
    source: Record<string, unknown>,
    target: Record<string, T>,
    valid: (v: unknown) => { entry: T; ok: boolean } | null,
  ) => {
    for (const [key, value] of Object.entries(source)) {
      const checked = validKey(key) ? valid(value) : null;
      if (checked) target[key] = checked.entry;
      if (checked?.ok) continue;
      dropped++;
      if (dropped <= MAX_MANIFEST_WARNINGS) {
        warn(`manifest entry ${JSON.stringify(key.slice(0, 80))} is not valid, redoing it`);
      }
    }
  };
  take(pageMap, manifest.pages, validPage);
  take(imageMap, manifest.images, validImage);
  if (dropped > MAX_MANIFEST_WARNINGS) {
    warn(`${dropped - MAX_MANIFEST_WARNINGS} more manifest entries are not valid, redoing them`);
  }
  return manifest;
}
