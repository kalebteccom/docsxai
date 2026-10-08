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
// work that did not land. A merge that answers `conflicts` has landed anyway: the push then fails
// and resets the hashes of the pages it wrote in a second change request, so the next push redoes them.
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
import {
  adfToMarkdown,
  pageSlug,
  quoted,
  safeName,
  singleLine,
  withTitle,
} from "./adf-markdown.js";
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
/**
 * Raw screenshot bytes in one content batch, which is one page. The rest are left out and
 * captioned, so a batch stays near 5.5 MB of JSON (base64 adds a third).
 */
export const MAX_PAGE_IMAGE_BYTES = 4 * 1024 * 1024;
/** Markdown of one page; a bigger page is refused rather than cut. */
export const MAX_PAGE_MARKDOWN_BYTES = 1024 * 1024;

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

/** A page title on one line: the prefix and the document title, joined and cut at line breaks. */
function pageTitle(titlePrefix: string | undefined, title: string): string {
  return singleLine(`${titlePrefix ?? ""}${title}`).trim();
}

/** Page identity of a section: the manifest key. */
function sectionKey(section: string): string {
  return section === "project" ? "index" : safeName(section);
}

/**
 * Refuses a projection whose pages would share an identity: two sections with one slug (which
 * covers a key that differs only in case), a section whose slug is the manifest page's, or a page
 * titled like the manifest, which a later push would take for it.
 */
function assertDistinctSections(documents: AdfDocument[], titlePrefix?: string): void {
  const owners = new Map<string, string>();
  for (const doc of documents) {
    const slug = pageSlug(sectionKey(doc.section));
    const other = owners.get(slug);
    if (other !== undefined) {
      throw new Error(
        `gitbook: sections ${quoted(other)} and ${quoted(doc.section)} share the page slug "${slug}", rename one of them`,
      );
    }
    owners.set(slug, doc.section);
    if (slug === MANIFEST_SLUG || pageTitle(titlePrefix, doc.title) === MANIFEST_TITLE) {
      throw new Error(
        `gitbook: section ${quoted(doc.section)} is named like the manifest page "${MANIFEST_TITLE}", rename it`,
      );
    }
  }
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
  const title = pageTitle(config.title_prefix, doc.title);
  const key = sectionKey(doc.section);
  const files: FileUpload[] = [];
  const refs = new Map<string, string>();
  const sources = new Map<string, { source: string; fileName: string }>();
  const hashes: Array<[string, string]> = [];
  let sent = 0;
  for (const att of doc.attachments) {
    // The projection can come from a caller, so the path is held inside the workspace and the
    // hash is taken from the bytes read, not from `att.sha256`.
    const data = await readRegularFile(
      await resolveWorkspacePathReal(workspaceDir, att.sourcePath),
    );
    const name = safeName(att.fileName);
    // Two screenshots that fold to one safe name would share a link target, so one page image
    // would show the other's bytes. The same file listed twice is one screenshot.
    const source = `${att.fileName}\0${att.sourcePath}`;
    const known = sources.get(name);
    if (known !== undefined && known.source !== source) {
      throw new Error(
        `gitbook: section ${quoted(doc.section)} has screenshots ${quoted(known.fileName)} and ${quoted(att.fileName)}, which both upload as ${quoted(name)}, rename one of them`,
      );
    }
    if (known !== undefined) continue;
    sources.set(name, { source, fileName: att.fileName });
    hashes.push([name, sha256Hex(data)]);
    const tooBig = data.byteLength > MAX_INLINE_IMAGE_BYTES;
    if (tooBig || sent + data.byteLength > MAX_PAGE_IMAGE_BYTES) {
      const why = tooBig
        ? `GitBook takes at most ${MAX_INLINE_IMAGE_BYTES} bytes inline per file`
        : `a page sends at most ${MAX_PAGE_IMAGE_BYTES} bytes of screenshots`;
      warnings.push(
        `section ${quoted(doc.section)}: screenshot ${name} (${data.byteLength} bytes) was not uploaded, ${why}`,
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
  const size = Buffer.byteLength(markdown);
  if (size > MAX_PAGE_MARKDOWN_BYTES) {
    throw new Error(
      `gitbook: section ${quoted(doc.section)} renders to ${size} bytes of markdown, over the ${MAX_PAGE_MARKDOWN_BYTES} byte limit of one page`,
    );
  }
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

/** One manifest write: an update of the manifest page, or the hidden page created on the first push. */
function manifestChange(
  manifest: Manifest,
  manifestPageId: string | undefined,
  parentPageId: string | undefined,
): ContentChange {
  const document = { markdown: withTitle(MANIFEST_TITLE, manifestToMarkdown(manifest)) };
  return manifestPageId
    ? { operation: "update_page", page: manifestPageId, title: MANIFEST_TITLE, document }
    : {
        operation: "insert_page",
        title: MANIFEST_TITLE,
        slug: MANIFEST_SLUG,
        ...(parentPageId ? { into: parentPageId } : {}),
        hidden: true,
        noIndex: true,
        noRobotsIndex: true,
        document,
      };
}

/** Runs `work` in a new change request and archives the draft when `work` throws. */
async function inChangeRequest<T>(
  client: GitBookClient,
  space: string,
  log: PluginLogger,
  work: (crId: string) => Promise<T>,
): Promise<T> {
  const crId = await client.createChangeRequest(space, CHANGE_REQUEST_SUBJECT);
  try {
    return await work(crId);
  } catch (e) {
    try {
      await client.archive(space, crId);
    } catch (archiveError) {
      log.warn(`change request ${crId} could not be archived: ${(archiveError as Error).message}`);
    }
    throw e;
  }
}

/**
 * A merge that answers `conflicts` has landed in the space, archived or not, and the manifest in it
 * already holds the new hashes. A second change request rewrites those entries with an empty hash
 * so the next push writes the pages again in place. The returned text is the failure the push
 * reports; it says what happens next.
 */
async function resetHashes(
  client: GitBookClient,
  config: GitBookPublishConfig,
  log: PluginLogger,
  manifest: Manifest,
  written: Map<string, string>,
  merged: { crId: string; manifestId: string | undefined },
): Promise<string> {
  const head = `change request ${merged.crId} was merged with conflicts, check the space for conflict markers`;
  const force = "push again with config.force to write every page again";
  try {
    if (!merged.manifestId) throw new Error("GitBook did not report the manifest page");
    for (const key of written.keys()) {
      manifest.pages[key] = { pageId: manifest.pages[key]!.pageId, sha256: "" };
    }
    const reset = await inChangeRequest(client, config.space_id, log, async (crId) => {
      await client.applyChanges(config.space_id, crId, [
        manifestChange(manifest, merged.manifestId, config.parent_page_id),
      ]);
      return client.merge(config.space_id, crId);
    });
    return reset === "conflicts"
      ? `${head}; resetting the manifest conflicted too, ${force}`
      : `${head}; the pages are marked unwritten, so the next push writes them again`;
  } catch (e) {
    log.warn(`manifest hashes were not reset: ${(e as Error).message}`);
    return `${head}; the manifest was not reset, ${force}`;
  }
}

export function createGitBookPublisher(options: GitBookPublisherOptions = {}): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "GITBOOK_TOKEN";
      const token = process.env[tokenVar];
      if (!token) throw new Error(`gitbook: missing API token, set ${tokenVar}`);

      const mask = maskToken(token);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(singleLine(mask(m))),
        warn: (m) => ctx.log.warn(singleLine(mask(m))),
        error: (m) => ctx.log.error(singleLine(mask(m))),
      };

      try {
        const config = parseConfig(ctx.config, options);
        const projection = await loadProjection(ctx);
        assertDistinctSections(projection.documents, config.title_prefix);
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
              `section ${quoted(p.section)}: page ${known.pageId} is not a page ${where(config)}, creating a new page`,
            );
          }
          if (config.force || !known || !current || known.sha256 !== p.sha256) todo.push(p);
        }

        const written = new Map<string, string>();
        let conflict: string | null = null;
        if (todo.length > 0) {
          const outcome = await inChangeRequest(client, space, log, async (crId) => {
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
                  `gitbook: GitBook did not report the page created for ${quoted(p.section)}`,
                );
              }
              manifest.pages[p.key] = { pageId: id, sha256: p.sha256 };
              written.set(p.key, id);
            }
            const applied = await client.applyChanges(space, crId, [
              manifestChange(manifest, manifestPage?.id, config.parent_page_id),
            ]);
            const merged = await client.merge(space, crId);
            return { crId, manifestId: manifestPage?.id ?? applied.created[0], merged };
          });
          if (outcome.merged === "conflicts") {
            conflict = await resetHashes(client, config, log, manifest, written, outcome);
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
          log.info(`section ${quoted(p.section)}: ${action} (page ${id})`);
          const url = urls.get(id);
          return { id, ...(url ? { url } : {}), action, section: p.section };
        });

        if (conflict) {
          warnings.push(conflict);
          log.error(conflict);
        }
        return { ok: conflict === null, target: `gitbook:space/${space}`, pages, warnings };
      } catch (e) {
        const masked = singleLine(mask((e as Error).message));
        log.error(masked);
        throw new Error(masked);
      }
    },
  };
}
