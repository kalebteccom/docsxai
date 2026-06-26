// Confluence Cloud publisher — the ONLY Confluence egress path in the docsxai tree.
//
// Consumes the engine's ADF projection (`docsxai export adf` / `projectDocPackToAdf`) and
// pushes it through the Confluence Cloud REST v2 API with built-in `fetch`. Idempotent by
// content hash: every published page carries a `docsxai-content-sha` content-property holding
// the sha256 of its projected content (title + ADF + attachment shas). Re-publishing an
// unchanged projection reads that property, sees a match, and performs ZERO mutations — no
// version bumps, no attachment uploads. Page identity is the `{ section → pageId }` map the
// caller passes in `config.page_map`; the result's `pages[]` entries echo `section` so the
// caller can persist the updated map.
//
// The API token is masked as `<CONFLUENCE_TOKEN>` (and its Basic-auth encoding likewise) in
// every error and log line this module produces.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  type AdfDoc,
  type AdfNode,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  type PublisherPlugin,
  type PublishResult,
  resolveWorkspacePath,
} from "@docsxai/engine";
import { ConfluenceClient } from "./confluence-client.js";

// Re-export the provider-neutral REST v2 transport + DTOs so external importers/tests can
// still reach them through this module's path after the split.
export {
  ConfluenceClient,
  type V2Attachment,
  type V2Page,
  type V2Property,
} from "./confluence-client.js";

export const CONTENT_SHA_PROPERTY = "docsxai-content-sha";
const SHA_COMMENT_PREFIX = "docsxai-sha256:";

export interface ConfluencePublishConfig {
  /** Site origin, e.g. `https://acme.atlassian.net`. */
  base_url: string;
  /** Target space id (v2 numeric space id, as a string). */
  space_id: string;
  /** Mirrors the projection's mode; informational — the projection's own `mode` drives layout. */
  mode?: "single" | "page-tree";
  /** Page identity: projection section → existing Confluence page id. Absent section → create. */
  page_map?: Record<string, string>;
  /** Existing page to nest under (single mode page / page-tree parent). */
  parent_page_id?: string;
  /** Prefixed onto every page title, e.g. `"[Docs] "`. */
  title_prefix?: string;
}

// ---------------------------------------------------------------------------
// canonical hashing
// ---------------------------------------------------------------------------

/** JSON.stringify with object keys sorted at every level — stable hash input. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// token masking
// ---------------------------------------------------------------------------

/** Replaces every occurrence of the secrets (raw and Basic-auth-encoded) with placeholders. */
export function makeMasker(secrets: string[]): (message: string) => string {
  const needles = secrets.filter((s) => s.length > 0);
  return (message: string) => {
    let out = message;
    for (const n of needles) out = out.split(n).join("<CONFLUENCE_TOKEN>");
    return out;
  };
}

// ---------------------------------------------------------------------------
// ADF media-id patching
// ---------------------------------------------------------------------------

/** Fills empty media `id`/`collection` attrs from the uploaded attachments, matching by `alt`. */
export function patchMediaIds(
  adf: AdfDoc,
  fileIdByName: Map<string, string>,
  pageId: string,
): AdfDoc {
  const visit = (node: AdfNode): AdfNode => {
    let next = node;
    if (node.type === "media" && node.attrs && typeof node.attrs["alt"] === "string") {
      const fileId = fileIdByName.get(node.attrs["alt"]);
      if (fileId) {
        next = {
          ...node,
          attrs: { ...node.attrs, id: fileId, collection: `contentId-${pageId}` },
        };
      }
    }
    if (next.content) next = { ...next, content: next.content.map(visit) };
    return next;
  };
  return { ...adf, content: adf.content.map(visit) };
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

function parseConfig(raw: Record<string, unknown>): ConfluencePublishConfig {
  const baseUrl = raw["base_url"];
  const spaceId = raw["space_id"];
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error('confluence: config.base_url is required (e.g. "https://acme.atlassian.net")');
  }
  if (typeof spaceId !== "string" || spaceId.length === 0) {
    throw new Error("confluence: config.space_id is required");
  }
  const pageMap = raw["page_map"];
  return {
    base_url: baseUrl.replace(/\/+$/, ""),
    space_id: spaceId,
    ...(raw["mode"] === "page-tree" || raw["mode"] === "single" ? { mode: raw["mode"] } : {}),
    ...(pageMap && typeof pageMap === "object"
      ? { page_map: pageMap as Record<string, string> }
      : {}),
    ...(typeof raw["parent_page_id"] === "string" ? { parent_page_id: raw["parent_page_id"] } : {}),
    ...(typeof raw["title_prefix"] === "string" ? { title_prefix: raw["title_prefix"] } : {}),
  };
}

function isProjection(value: unknown): value is AdfProjection {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as AdfProjection).documents) &&
    typeof (value as AdfProjection).mode === "string"
  );
}

async function loadProjection(ctx: PublisherContext): Promise<AdfProjection> {
  if (isProjection(ctx.projection)) return ctx.projection;
  // Fall back to the exported artifact (`docsxai export adf` writes it).
  const p = resolveWorkspacePath(ctx.workspaceDir, ".export", "adf", "projection.json");
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    throw new Error(
      `confluence: no ADF projection — pass one in ctx.projection or run \`docsxai export adf\` first (looked at ${p})`,
    );
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isProjection(parsed)) throw new Error(`confluence: ${p} is not an ADF projection`);
  return parsed;
}

/** sha over everything that affects the published page: title, body, attachment content. */
function contentShaOf(
  title: string,
  adf: AdfDoc,
  attachments: Array<{ fileName: string; sha256: string }>,
): string {
  return sha256Hex(
    canonicalJson({
      title,
      adf,
      attachments: attachments.map((a) => ({ fileName: a.fileName, sha256: a.sha256 })),
    }),
  );
}

interface PublishOneResult {
  page: { id: string; url?: string; action: "created" | "updated" | "unchanged"; section: string };
}

async function publishDocument(opts: {
  client: ConfluenceClient;
  config: ConfluencePublishConfig;
  log: PluginLogger;
  section: string;
  title: string;
  adf: AdfDoc;
  attachments: Array<{ fileName: string; sourcePath: string; sha256: string }>;
  parentId?: string;
}): Promise<PublishOneResult> {
  const { client, config, log, section, title, adf, attachments } = opts;
  const contentSha = contentShaOf(title, adf, attachments);
  const knownId = config.page_map?.[section];

  const pageUrl = (id: string) => `${config.base_url}/wiki/spaces/${config.space_id}/pages/${id}`;

  if (knownId) {
    const existing = await client.getContentProperty(knownId, CONTENT_SHA_PROPERTY);
    if (existing && existing.value === contentSha) {
      log.info(`section "${section}": unchanged (page ${knownId})`);
      return { page: { id: knownId, url: pageUrl(knownId), action: "unchanged", section } };
    }

    // Changed: upload only attachments whose sha marker differs, then one version-bump update.
    const current = await client.getPage(knownId);
    const remote = await client.listAttachments(knownId);
    const remoteByName = new Map(remote.map((a) => [a.title, a]));
    const fileIdByName = new Map<string, string>();
    for (const att of attachments) {
      const found = remoteByName.get(att.fileName);
      if (found && found.comment === `${SHA_COMMENT_PREFIX}${att.sha256}`) {
        if (found.fileId) fileIdByName.set(att.fileName, found.fileId);
        continue;
      }
      const uploaded = await client.uploadAttachment({
        pageId: knownId,
        fileName: att.fileName,
        data: await fs.readFile(att.sourcePath),
        comment: `${SHA_COMMENT_PREFIX}${att.sha256}`,
      });
      if (uploaded.fileId) fileIdByName.set(att.fileName, uploaded.fileId);
    }

    await client.updatePage({
      id: knownId,
      title,
      version: current.version.number + 1,
      adf: patchMediaIds(adf, fileIdByName, knownId),
    });
    if (existing) await client.updateContentProperty(knownId, existing, contentSha);
    else await client.createContentProperty(knownId, CONTENT_SHA_PROPERTY, contentSha);
    log.info(`section "${section}": updated page ${knownId}`);
    return { page: { id: knownId, url: pageUrl(knownId), action: "updated", section } };
  }

  // Create: page first (attachments need a page id), then uploads, then one body patch for
  // the media file ids, then the content property.
  const created = await client.createPage({
    spaceId: config.space_id,
    title,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    adf,
  });
  const fileIdByName = new Map<string, string>();
  for (const att of attachments) {
    const uploaded = await client.uploadAttachment({
      pageId: created.id,
      fileName: att.fileName,
      data: await fs.readFile(att.sourcePath),
      comment: `${SHA_COMMENT_PREFIX}${att.sha256}`,
    });
    if (uploaded.fileId) fileIdByName.set(att.fileName, uploaded.fileId);
  }
  if (fileIdByName.size > 0) {
    await client.updatePage({
      id: created.id,
      title,
      version: created.version.number + 1,
      adf: patchMediaIds(adf, fileIdByName, created.id),
    });
  }
  await client.createContentProperty(created.id, CONTENT_SHA_PROPERTY, contentSha);
  log.info(`section "${section}": created page ${created.id}`);
  return { page: { id: created.id, url: pageUrl(created.id), action: "created", section } };
}

export function createConfluencePublisher(): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "CONFLUENCE_TOKEN";
      const emailVar = ctx.secretsEnv["email"] ?? "CONFLUENCE_EMAIL";
      const token = process.env[tokenVar];
      const email = process.env[emailVar];
      if (!token) throw new Error(`confluence: missing API token — set ${tokenVar}`);
      if (!email) throw new Error(`confluence: missing account email — set ${emailVar}`);

      const mask = makeMasker([token, Buffer.from(`${email}:${token}`).toString("base64")]);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(mask(m)),
        warn: (m) => ctx.log.warn(mask(m)),
        error: (m) => ctx.log.error(mask(m)),
      };

      try {
        const config = parseConfig(ctx.config);
        const projection = await loadProjection(ctx);
        const client = new ConfluenceClient(config.base_url, email, token, mask);

        const warnings = [...projection.warnings];
        const pages: PublishResult["pages"] = [];
        const withTitle = (t: string) => `${config.title_prefix ?? ""}${t}`;

        if (projection.mode === "page-tree") {
          // Parent first ("project" section, or the first document), children nest under it.
          const docs = [...projection.documents];
          const parentIdx = Math.max(
            docs.findIndex((d) => d.section === "project"),
            0,
          );
          const [parentDoc] = docs.splice(parentIdx, 1);
          const parentResult = await publishDocument({
            client,
            config,
            log,
            section: parentDoc!.section,
            title: withTitle(parentDoc!.title),
            adf: parentDoc!.adf,
            attachments: parentDoc!.attachments,
            ...(config.parent_page_id ? { parentId: config.parent_page_id } : {}),
          });
          pages.push(parentResult.page);
          for (const doc of docs) {
            const r = await publishDocument({
              client,
              config,
              log,
              section: doc.section,
              title: withTitle(doc.title),
              adf: doc.adf,
              attachments: doc.attachments,
              parentId: parentResult.page.id,
            });
            pages.push(r.page);
          }
        } else {
          for (const doc of projection.documents) {
            const r = await publishDocument({
              client,
              config,
              log,
              section: doc.section,
              title: withTitle(doc.title),
              adf: doc.adf,
              attachments: doc.attachments,
              ...(config.parent_page_id ? { parentId: config.parent_page_id } : {}),
            });
            pages.push(r.page);
          }
        }

        return {
          ok: true,
          target: `confluence:${config.base_url} space ${config.space_id}`,
          pages,
          warnings,
        };
      } catch (e) {
        const masked = mask((e as Error).message);
        log.error(masked);
        throw new Error(masked);
      }
    },
  };
}
