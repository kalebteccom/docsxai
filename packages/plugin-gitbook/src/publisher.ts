// GitBook publisher: the only GitBook egress path in the docsxai tree.
//
// Consumes the engine's ADF projection (`docsxai export adf`), renders each document to markdown
// and publishes one page per document in a GitBook space. Content reaches a space through a change
// request (GitBook's branch-like draft): the publisher opens one, applies the page and screenshot
// changes as content batches, writes the manifest page into the same draft and merges it. Page
// identity is the section name, mapped to a page id in the manifest page (see manifest.ts).
//
// Idempotency: the manifest records the content hash of every page, the hash covering the title,
// the rendered markdown and the sha256 of every screenshot. A push writes only pages whose hash
// changed and opens a change request only when there is something to write. An unchanged pack
// costs a page listing, a read of the manifest page and zero writes. A push that fails before the
// merge archives its draft, so nothing half-written goes live and the manifest never describes
// work that did not land.
//
// The API token is read from the environment variable named in `secretsEnv.token` and is masked
// in every error and log line.

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
import { adfToMarkdown, pageSlug, safeName, withTitle } from "./adf-markdown.js";
import { type GitBookPublishConfig, maskToken, parseConfig } from "./config.js";
import {
  type ContentChange,
  GitBookClient,
  type GitBookClientOptions,
  type GitBookUrlOptions,
  type LivePage,
} from "./gitbook-client.js";
import {
  emptyManifest,
  type Manifest,
  MANIFEST_SLUG,
  MANIFEST_TITLE,
  manifestToMarkdown,
  parseManifestMarkdown,
} from "./manifest.js";
import { readRegularFile } from "./read-file.js";

/** Options of the publisher itself, not of a publish call. */
export type GitBookPublisherOptions = GitBookUrlOptions & GitBookClientOptions;

/**
 * Largest screenshot sent inline. GitBook's `insert_files` takes inline bytes up to 1 MB of base64;
 * 700,000 bytes encode to about 933,000 characters, under that limit whichever way the 1 MB counts.
 */
export const MAX_INLINE_IMAGE_BYTES = 700_000;
/** Screenshot bytes sent with one page. The rest are left out, so one batch stays a sane request size. */
export const MAX_PAGE_IMAGE_BYTES = 16 * 1024 * 1024;

const CHANGE_REQUEST_SUBJECT = "docsxai push";

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
      `gitbook: no ADF projection, pass one in ctx.projection or run \`docsxai export adf\` first (looked at ${p})`,
    );
  });
  const parsed = JSON.parse(text) as unknown;
  if (!isProjection(parsed)) throw new Error(`gitbook: ${p} is not an ADF projection`);
  return parsed;
}

interface FileUpload {
  ref: string;
  name: string;
  contentType: string;
  base64: string;
}

interface Prepared {
  section: string;
  key: string;
  title: string;
  markdown: string;
  sha256: string;
  files: FileUpload[];
}

/**
 * One document rendered and hashed. Screenshots are read from inside the workspace and hashed as
 * read; those that fit GitBook's inline limit travel with the page, the others are named in
 * `warnings` and replaced by a caption.
 */
async function prepare(
  workspaceDir: string,
  doc: AdfDocument,
  config: GitBookPublishConfig,
  warnings: string[],
): Promise<Prepared> {
  const title = `${config.title_prefix ?? ""}${doc.title}`;
  const key = doc.section === "project" ? "index" : safeName(doc.section);
  const files: FileUpload[] = [];
  const refs = new Map<string, string>();
  const hashes: Array<[string, string]> = [];
  let sent = 0;
  for (const att of doc.attachments) {
    // The projection can come from a caller, so the path is held inside the workspace and the
    // hash is taken from the bytes read, not from `att.sha256`.
    const data = await readRegularFile(
      await resolveWorkspacePathReal(workspaceDir, att.sourcePath),
    );
    const name = safeName(att.fileName);
    hashes.push([name, sha256Hex(data)]);
    if (data.byteLength > MAX_INLINE_IMAGE_BYTES || sent + data.byteLength > MAX_PAGE_IMAGE_BYTES) {
      warnings.push(
        `section "${doc.section}": screenshot ${name} (${data.byteLength} bytes) was not uploaded, GitBook takes at most ${MAX_INLINE_IMAGE_BYTES} bytes inline per file`,
      );
      continue;
    }
    sent += data.byteLength;
    const ref = `docsxai-img-${files.length}`;
    files.push({
      ref,
      name,
      contentType: "image/png",
      base64: data.toString("base64"),
    });
    refs.set(name, `./${ref}`);
  }
  const markdown = withTitle(
    title,
    adfToMarkdown(doc.adf, (name) => refs.get(name)),
  );
  const sha256 = sha256Hex(
    JSON.stringify([title, pageSlug(key), config.parent_page_id ?? null, markdown, hashes]),
  );
  return { section: doc.section, key, title, markdown, sha256, files };
}

/** Where pages live, for messages. */
function where(config: GitBookPublishConfig): string {
  return config.parent_page_id ? `under ${config.parent_page_id}` : "at the top level of the space";
}

function findPage(pages: LivePage[], id: string): LivePage | undefined {
  for (const page of pages) {
    const hit = page.id === id ? page : findPage(page.pages, id);
    if (hit) return hit;
  }
  return undefined;
}

function urlsById(pages: LivePage[], into = new Map<string, string>()): Map<string, string> {
  for (const page of pages) {
    if (page.appUrl) into.set(page.id, page.appUrl);
    urlsById(page.pages, into);
  }
  return into;
}

interface LoadedManifest {
  manifest: Manifest;
  /** The page holding it, when one exists. */
  page?: LivePage;
}

/** The manifest page: pinned by `manifest_page_id`, else the one page with the manifest title. */
async function loadManifest(
  client: GitBookClient,
  config: GitBookPublishConfig,
  siblings: LivePage[],
  log: PluginLogger,
): Promise<LoadedManifest> {
  let page: LivePage | undefined;
  if (config.manifest_page_id) {
    page = siblings.find((p) => p.id === config.manifest_page_id);
    if (!page) {
      throw new Error(
        `gitbook: manifest page ${config.manifest_page_id} is not a page ${where(config)}`,
      );
    }
  } else {
    const hits = siblings.filter((p) => p.title === MANIFEST_TITLE);
    if (hits.length > 1) {
      throw new Error(
        `gitbook: ${hits.length} pages titled "${MANIFEST_TITLE}" side by side, delete the extra ones or set config.manifest_page_id`,
      );
    }
    page = hits[0];
  }
  if (!page) return { manifest: emptyManifest() };
  const markdown = await client.getPageMarkdown(config.space_id, page.id);
  if (markdown === null) return { manifest: emptyManifest() };
  const manifest = parseManifestMarkdown(markdown, (m) => log.warn(m), `manifest page ${page.id}`);
  return { manifest, page };
}

export function createGitBookPublisher(options: GitBookPublisherOptions = {}): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "GITBOOK_TOKEN";
      const token = process.env[tokenVar];
      if (!token) throw new Error(`gitbook: missing API token, set ${tokenVar}`);

      const mask = maskToken(token);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(mask(m)),
        warn: (m) => ctx.log.warn(mask(m)),
        error: (m) => ctx.log.error(mask(m)),
      };

      try {
        const config = parseConfig(ctx.config, options);
        const projection = await loadProjection(ctx);
        const client = new GitBookClient(config.base_url, token, mask, options);
        const space = config.space_id;

        const tree = await client.listPages(space);
        let scope = tree;
        if (config.parent_page_id) {
          const parent = findPage(tree, config.parent_page_id);
          if (!parent) {
            throw new Error(`gitbook: parent page ${config.parent_page_id} is not in the space`);
          }
          scope = parent.pages;
        }
        // Pages are only created, found and updated directly under the target, so a page id the
        // manifest names anywhere else in the space is never written.
        const siblings = scope.filter((p) => p.type === "document");
        const { manifest, page: manifestPage } = await loadManifest(client, config, siblings, log);
        const live = new Map(
          siblings
            .filter((p) => p.id !== manifestPage?.id)
            .map((p): [string, LivePage] => [p.id, p]),
        );

        const warnings = [...projection.warnings];
        const prepared: Prepared[] = [];
        for (const doc of projection.documents) {
          prepared.push(await prepare(ctx.workspaceDir, doc, config, warnings));
        }

        const found = new Map<string, LivePage | undefined>();
        const todo: Prepared[] = [];
        for (const p of prepared) {
          const known = manifest.pages[p.key];
          const current = known ? live.get(known.pageId) : undefined;
          found.set(p.key, current);
          if (known && !current) {
            log.warn(
              `section "${p.section}": page ${known.pageId} is not a page ${where(config)}, creating a new page`,
            );
          }
          if (config.force || !known || !current || known.sha256 !== p.sha256) todo.push(p);
        }

        const written = new Map<string, string>();
        if (todo.length > 0) {
          const crId = await client.createChangeRequest(space, CHANGE_REQUEST_SUBJECT);
          try {
            for (const p of todo) {
              const current = found.get(p.key);
              const changes: ContentChange[] = [];
              if (p.files.length > 0) changes.push({ operation: "insert_files", files: p.files });
              changes.push(
                current
                  ? {
                      operation: "update_page",
                      page: current.id,
                      title: p.title,
                      document: { markdown: p.markdown },
                    }
                  : {
                      operation: "insert_page",
                      title: p.title,
                      slug: pageSlug(p.key),
                      ...(config.parent_page_id ? { into: config.parent_page_id } : {}),
                      document: { markdown: p.markdown },
                    },
              );
              const applied = await client.applyChanges(space, crId, changes);
              const id = current?.id ?? applied.created[0];
              if (!id) {
                throw new Error(
                  `gitbook: GitBook did not report the page created for "${p.section}"`,
                );
              }
              manifest.pages[p.key] = { pageId: id, sha256: p.sha256 };
              written.set(p.key, id);
            }

            const body = { markdown: withTitle(MANIFEST_TITLE, manifestToMarkdown(manifest)) };
            await client.applyChanges(space, crId, [
              manifestPage
                ? {
                    operation: "update_page",
                    page: manifestPage.id,
                    title: MANIFEST_TITLE,
                    document: body,
                  }
                : {
                    operation: "insert_page",
                    title: MANIFEST_TITLE,
                    slug: MANIFEST_SLUG,
                    ...(config.parent_page_id ? { into: config.parent_page_id } : {}),
                    hidden: true,
                    noIndex: true,
                    noRobotsIndex: true,
                    document: body,
                  },
            ]);
            if ((await client.merge(space, crId)) === "conflicts") {
              const note = `change request ${crId} was merged with conflicts, check the space for conflict markers`;
              log.warn(note);
              warnings.push(note);
            }
          } catch (e) {
            try {
              await client.archive(space, crId);
            } catch (archiveError) {
              log.warn(
                `change request ${crId} could not be archived: ${(archiveError as Error).message}`,
              );
            }
            throw e;
          }
        }

        let urls = urlsById(tree);
        if (written.size > 0) {
          try {
            urls = urlsById(await client.listPages(space));
          } catch (e) {
            log.warn(`page URLs not refreshed after the merge: ${(e as Error).message}`);
          }
        }

        const pages: PublishResult["pages"] = prepared.map((p) => {
          const id = written.get(p.key) ?? manifest.pages[p.key]!.pageId;
          const action = !written.has(p.key)
            ? "unchanged"
            : found.get(p.key)
              ? "updated"
              : "created";
          log.info(`section "${p.section}": ${action} (page ${id})`);
          const url = urls.get(id);
          return { id, ...(url ? { url } : {}), action, section: p.section };
        });

        return { ok: true, target: `gitbook:space/${space}`, pages, warnings };
      } catch (e) {
        const masked = mask((e as Error).message);
        log.error(masked);
        throw new Error(masked);
      }
    },
  };
}
