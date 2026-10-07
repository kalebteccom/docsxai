// Notion publisher: the only Notion egress path in the docsxai tree.
//
// Consumes the engine's ADF projection (`docsxai export adf`), converts each document to Notion
// blocks and creates or rewrites one page per document under a parent page or in a database, with
// its screenshots uploaded through the file upload API and attached as image blocks. Page identity
// is the section name, mapped to a page id in the manifest page (see manifest.ts).
//
// Idempotency: the manifest records the content hash of every page. The hash covers the title, the
// parent and the blocks, with each image standing in as the sha256 of its bytes. A push writes
// only pages whose hash changed and the manifest only when something was written, so an unchanged
// pack costs a lookup of the manifest page, a read of it and zero writes. The manifest is written
// last, and a page whose rewrite did not finish is recorded with an empty hash, so a push that
// fails midway redoes exactly that page.
//
// Rewriting a page deletes its content blocks and appends the new ones, in that order: Notion has
// no call that replaces children. An image upload expires an hour after it is made unless a block
// uses it, so images are uploaded after the old blocks are gone and right before the append.
//
// The token is read from the environment variable named in `secretsEnv.token` and is masked in
// every error and log line.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  type AdfDocument,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  type PublisherPlugin,
  type PublishResult,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
} from "@docsxai/engine";
import { maskToken, type NotionPublishConfig, parseConfig } from "./config.js";
import {
  emptyManifest,
  type Manifest,
  MANIFEST_TITLE,
  manifestBlocks,
  parseManifestText,
} from "./manifest.js";
import { adfToBlocks, type ImageResolver, safeName, splitText } from "./notion-blocks.js";
import {
  NotionClient,
  type NotionClientOptions,
  type NotionPage,
  type NotionUrlOptions,
} from "./notion-client.js";
import { readRegularFile } from "./read-file.js";

/** Options of the publisher itself, not of a publish call. */
export type NotionPublisherOptions = NotionUrlOptions & NotionClientOptions;

/** Largest file the single-part upload API takes. Bigger screenshots are published as a note. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const PAGE_HASH_SCHEMA = "docsxai/notion-page@1";

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function isProjection(value: unknown): value is AdfProjection {
  const v = value as { documents?: unknown } | null;
  return typeof v === "object" && v !== null && Array.isArray(v.documents);
}

async function loadProjection(ctx: PublisherContext): Promise<AdfProjection> {
  if (isProjection(ctx.projection)) return ctx.projection;
  const p = resolveWorkspacePath(ctx.workspaceDir, ".export", "adf", "projection.json");
  const text = await fs.readFile(p, "utf8").catch(() => {
    throw new Error(
      `notion: no ADF projection, pass one in ctx.projection or run \`docsxai export adf\` first (looked at ${p})`,
    );
  });
  const parsed = JSON.parse(text) as unknown;
  if (!isProjection(parsed)) throw new Error(`notion: ${p} is not an ADF projection`);
  return parsed;
}

/** The properties that set a page's title: the database's title property, or `title` under a page. */
function titleProperties(config: NotionPublishConfig, title: string): Record<string, unknown> {
  const key = config.parent.type === "database_id" ? config.title_property : "title";
  const content = splitText(title)[0] ?? "";
  return { [key]: { title: [{ type: "text", text: { content } }] } };
}

interface LoadedManifest {
  manifest: Manifest;
  /** Id of the page holding it, when one exists. */
  pageId?: string;
}

/** The id of the one page titled like the manifest under the parent, or undefined. */
async function findManifestPage(
  client: NotionClient,
  config: NotionPublishConfig,
): Promise<string | undefined> {
  let ids: string[];
  if (config.parent.type === "database_id") {
    const hits = await client.findByTitle(config.parent.id, config.title_property, MANIFEST_TITLE);
    ids = hits.map((p) => p.id);
  } else {
    const { children, truncated } = await client.readChildren(config.parent.id);
    ids = children
      .filter((c) => c.type === "child_page" && c.childTitle === MANIFEST_TITLE)
      .map((c) => c.id);
    if (ids.length === 0 && truncated) {
      throw new Error(
        `notion: the parent page has too many children to find the "${MANIFEST_TITLE}" page, set config.manifest_page_id`,
      );
    }
  }
  if (ids.length > 1) {
    throw new Error(
      `notion: ${ids.length} pages titled "${MANIFEST_TITLE}" under the parent, delete the extra ones or set config.manifest_page_id`,
    );
  }
  return ids[0];
}

/** True when a page sits directly under the configured parent and is not in the trash. */
function isUnderParent(page: NotionPage, config: NotionPublishConfig): boolean {
  return (
    !page.trashed && page.parent?.type === config.parent.type && page.parent.id === config.parent.id
  );
}

/** The manifest page: pinned by `manifest_page_id`, else the one page with the manifest title. */
async function loadManifest(
  client: NotionClient,
  config: NotionPublishConfig,
  log: PluginLogger,
): Promise<LoadedManifest> {
  let pageId = config.manifest_page_id;
  if (pageId) {
    const page = await client.getPage(pageId);
    if (!page || page.trashed) throw new Error(`notion: manifest page ${pageId} does not exist`);
    if (!isUnderParent(page, config)) {
      throw new Error(`notion: manifest page ${pageId} is not under the configured parent`);
    }
  } else {
    pageId = await findManifestPage(client, config);
  }
  if (!pageId) return { manifest: emptyManifest() };
  const { children, truncated } = await client.readChildren(pageId);
  if (truncated) throw new Error(`notion: manifest page ${pageId} is not a docsxai manifest`);
  const text = children.map((c) => c.codeText ?? "").join("");
  // A write that died after clearing the page, or after creating it, leaves it with no JSON. That
  // is an interrupted write of our own, so the pages are redone (and may be created a second time)
  // instead of every later push failing. A page with JSON that is not a manifest still refuses.
  if (text.trim() === "" && children.every((c) => c.type === "paragraph" || c.type === "code")) {
    log.warn(
      `manifest page ${pageId} is empty, so an earlier push was interrupted; every page is written again and may be created a second time`,
    );
    return { manifest: emptyManifest(), pageId };
  }
  const manifest = parseManifestText(text, (m) => log.warn(m), `manifest page ${pageId}`);
  return { manifest, pageId };
}

interface Image {
  name: string;
  data: Uint8Array;
  sha256: string;
}

/** A document's screenshots by safe name, read from inside the workspace and hashed as read. */
async function readImages(workspaceDir: string, doc: AdfDocument): Promise<Map<string, Image>> {
  const images = new Map<string, Image>();
  for (const att of doc.attachments) {
    // The projection can come from a caller, so the path is held inside the workspace and the
    // hash is taken from the bytes read, not from `att.sha256`.
    const data = await readRegularFile(
      await resolveWorkspacePathReal(workspaceDir, att.sourcePath),
    );
    const name = safeName(att.fileName);
    images.set(name, { name, data, sha256: sha256Hex(data) });
  }
  return images;
}

function tooBigNote(image: Image): { note: string } {
  return {
    note: `Screenshot ${image.name} (${image.data.byteLength} bytes) is over Notion's ${MAX_UPLOAD_BYTES} byte upload limit and was not published.`,
  };
}

export function createNotionPublisher(options: NotionPublisherOptions = {}): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "NOTION_TOKEN";
      const token = process.env[tokenVar];
      if (!token) throw new Error(`notion: missing integration token, set ${tokenVar}`);

      const mask = maskToken(token);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(mask(m)),
        warn: (m) => ctx.log.warn(mask(m)),
        error: (m) => ctx.log.error(mask(m)),
      };

      try {
        const config = parseConfig(ctx.config, options);
        const projection = await loadProjection(ctx);
        const client = new NotionClient(config.base_url, token, mask, options);
        const { manifest, pageId: manifestPageId } = await loadManifest(client, config, log);

        let dirty = false;
        const pages: PublishResult["pages"] = [];
        let failure: { error: unknown } | null = null;
        try {
          for (const doc of projection.documents) {
            const title = `${config.title_prefix ?? ""}${doc.title}`;
            const key = doc.section === "project" ? "index" : safeName(doc.section);
            const images = await readImages(ctx.workspaceDir, doc);

            // The blocks as hashed: an image stands in as the hash of its bytes, so the hash does
            // not depend on upload ids. Only images the page uses are uploaded.
            const used = new Set<string>();
            const stand: ImageResolver = (name) => {
              const image = images.get(name);
              if (!image) return undefined;
              used.add(name);
              return image.data.byteLength > MAX_UPLOAD_BYTES
                ? tooBigNote(image)
                : { fileUploadId: `sha256:${image.sha256}` };
            };
            const sha256 = sha256Hex(
              JSON.stringify([
                PAGE_HASH_SCHEMA,
                title,
                config.parent,
                config.title_property,
                adfToBlocks(doc.adf, stand),
              ]),
            );
            const known = manifest.pages[key];
            if (!config.force && known?.sha256 === sha256) {
              log.info(`section "${doc.section}": unchanged (page ${known.pageId})`);
              pages.push({
                id: known.pageId,
                ...(known.url ? { url: known.url } : {}),
                action: "unchanged",
                section: doc.section,
              });
              continue;
            }

            let existing = known ? await client.getPage(known.pageId) : null;
            // The page id comes from a manifest anyone with edit rights on that page can change, so
            // a page is only rewritten when it sits under the configured parent and is not the
            // manifest itself.
            if (existing && (!isUnderParent(existing, config) || existing.id === manifestPageId)) {
              if (!existing.trashed) {
                log.warn(
                  `section "${doc.section}": page ${existing.id} is not a page under the configured parent, creating a new page`,
                );
              }
              existing = null;
            }

            // The entry records "redo me" until the last block is appended.
            const page =
              existing ?? (await client.createPage(config.parent, titleProperties(config, title)));
            manifest.pages[key] = {
              pageId: page.id,
              sha256: "",
              ...(page.url ? { url: page.url } : {}),
            };
            dirty = true;
            if (existing) {
              await client.setProperties(page.id, titleProperties(config, title));
              await client.clearChildren(page.id);
            }
            const ids = new Map<string, string>();
            for (const name of used) {
              const image = images.get(name)!;
              if (image.data.byteLength > MAX_UPLOAD_BYTES) {
                log.warn(`section "${doc.section}": ${tooBigNote(image).note}`);
                continue;
              }
              ids.set(name, await client.uploadFile(name, image.data, "image/png"));
            }
            const real: ImageResolver = (name) => {
              const image = images.get(name);
              if (!image) return undefined;
              const id = ids.get(name);
              return id === undefined ? tooBigNote(image) : { fileUploadId: id };
            };
            await client.appendBlocks(page.id, adfToBlocks(doc.adf, real));
            manifest.pages[key] = {
              pageId: page.id,
              sha256,
              ...(page.url ? { url: page.url } : {}),
            };
            const action = existing ? "updated" : "created";
            log.info(`section "${doc.section}": ${action} (page ${page.id})`);
            pages.push({
              id: page.id,
              ...(page.url ? { url: page.url } : {}),
              action,
              section: doc.section,
            });
          }
        } catch (e) {
          failure = { error: e };
        }
        // The manifest still records what was written before a failure. Each call is bounded by the
        // client timeout, and a failed manifest write never hides the error that stopped the push.
        if (dirty) {
          try {
            const blocks = manifestBlocks(manifest);
            if (manifestPageId) {
              await client.clearChildren(manifestPageId);
              await client.appendBlocks(manifestPageId, blocks);
            } else {
              const created = await client.createPage(
                config.parent,
                titleProperties(config, MANIFEST_TITLE),
              );
              await client.appendBlocks(created.id, blocks);
              log.info(
                `manifest page ${created.id} created, set config.manifest_page_id to skip the lookup for it`,
              );
            }
          } catch (e) {
            if (!failure) throw e;
            log.error(`manifest write failed: ${(e as Error).message}`);
          }
        }
        if (failure) throw failure.error;

        return {
          ok: true,
          target: `notion:${config.parent.type === "page_id" ? "page" : "database"}/${config.parent.id}`,
          pages,
          warnings: [...projection.warnings],
        };
      } catch (e) {
        const masked = mask((e as Error).message);
        log.error(masked);
        throw new Error(masked);
      }
    },
  };
}
