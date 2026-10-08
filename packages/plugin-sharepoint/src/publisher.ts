// SharePoint Online publisher: the only SharePoint egress path in the docsxai tree.
//
// Consumes the engine's ADF projection (`docsxai export adf`), renders each document to
// markdown and uploads it, plus its screenshots, into a folder of a document library through
// Microsoft Graph. Page identity is the file path, so no page map is needed.
//
// Idempotency: a `docsxai-manifest.json` file next to the pages records the sha256 and size of
// every file this plugin wrote. A push compares the local sha256 of each file with the
// manifest and uploads only what differs. An unchanged pack costs one read and zero writes.
// The manifest is written last, so a push that fails midway is redone for the missing files.
//
// The bearer token is read from the environment variable named in `secretsEnv.token` and is
// masked as `<SHAREPOINT_TOKEN>` in every error and log line.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  type AdfAttachment,
  type AdfDocument,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  type PublisherPlugin,
  type PublishResult,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
} from "@docsxai/engine";
import { adfToMarkdown, IMAGES_DIR, safeName, singleLine, titleLine } from "./adf-markdown.js";
import { readRegularFile } from "./read-file.js";
import {
  assertGraphBaseUrl,
  DEFAULT_GRAPH_URL,
  GraphClient,
  type GraphClientOptions,
  type GraphUrlOptions,
  SHAREPOINT_DOMAINS,
} from "./graph-client.js";

export const MANIFEST_FILE = "docsxai-manifest.json";
const MANIFEST_SCHEMA = "docsxai/sharepoint-manifest@1";

export interface SharePointPublishConfig {
  /** Document library id; takes precedence over `site_id`. */
  drive_id?: string;
  /** Site id; the site's default document library is used. */
  site_id?: string;
  /** Folder inside the library, no leading slash. Default `docsxai`. */
  folder: string;
  /**
   * Graph endpoint. Default `https://graph.microsoft.com/v1.0`. Must be `https` on
   * `graph.microsoft.com`, `graph.microsoft.us`, `microsoftgraph.chinacloudapi.cn` or `graph.microsoft.de`,
   * with the path `/v1.0` or `/beta` and no query or fragment.
   */
  graph_base_url: string;
  /** Prefixed onto every page title. */
  title_prefix?: string;
  /** Upload every file even when the manifest says it is unchanged. */
  force?: boolean;
}

interface ManifestEntry {
  sha256: string;
  size: number;
  id?: string;
  webUrl?: string;
}

/** Options of the publisher itself, not of a publish call. */
export type SharePointPublisherOptions = GraphUrlOptions & GraphClientOptions;

/** True for an `https:` URL on a SharePoint domain, with no credentials. */
export function isSharePointUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    SHAREPOINT_DOMAINS.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))
  );
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Invalid manifest entries named in the log; the rest are counted in one line. */
const MAX_MANIFEST_WARNINGS = 20;

/** A manifest entry as the publisher wrote it, or null when anything about it is off. */
function validEntry(value: unknown): ManifestEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (typeof e["sha256"] !== "string" || !SHA256_HEX.test(e["sha256"])) return null;
  if (typeof e["size"] !== "number" || !Number.isSafeInteger(e["size"]) || e["size"] < 0) {
    return null;
  }
  if (e["id"] !== undefined && (typeof e["id"] !== "string" || e["id"].length > 256)) return null;
  if (e["webUrl"] !== undefined && !isSharePointUrl(e["webUrl"])) return null;
  return {
    sha256: e["sha256"],
    size: e["size"],
    ...(e["id"] !== undefined ? { id: e["id"] } : {}),
    ...(e["webUrl"] !== undefined ? { webUrl: e["webUrl"] } : {}),
  };
}

interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  files: Record<string, ManifestEntry>;
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Replaces every occurrence of the token with a placeholder. */
export function maskToken(token: string): (message: string) => string {
  return (message) => (token ? message.replaceAll(token, "<SHAREPOINT_TOKEN>") : message);
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function parseConfig(
  raw: Record<string, unknown>,
  options: GraphUrlOptions = {},
): SharePointPublishConfig {
  const driveId = optionalString(raw, "drive_id");
  const siteId = optionalString(raw, "site_id");
  if (!driveId && !siteId) {
    throw new Error("sharepoint: config.drive_id or config.site_id is required");
  }
  const parts = (optionalString(raw, "folder") ?? "").split("/").filter(Boolean);
  const dotted = parts.find((p) => /^\.+$/.test(p));
  if (dotted !== undefined) {
    throw new Error(`sharepoint: config.folder must not contain a "${dotted}" segment`);
  }
  const folder = parts.length > 0 ? parts : ["docsxai"];
  const prefix = singleLine(optionalString(raw, "title_prefix") ?? "");
  return {
    ...(driveId ? { drive_id: driveId } : {}),
    ...(siteId ? { site_id: siteId } : {}),
    folder: folder.map(safeName).join("/"),
    graph_base_url: assertGraphBaseUrl(
      optionalString(raw, "graph_base_url") ?? DEFAULT_GRAPH_URL,
      options,
    ),
    ...(prefix ? { title_prefix: prefix } : {}),
    ...(raw["force"] === true ? { force: true } : {}),
  };
}

function isProjection(value: unknown): value is AdfProjection {
  const v = value as Partial<AdfProjection> | null;
  return typeof v === "object" && v !== null && Array.isArray(v.documents);
}

async function loadProjection(ctx: PublisherContext): Promise<AdfProjection> {
  if (isProjection(ctx.projection)) return ctx.projection;
  const p = resolveWorkspacePath(ctx.workspaceDir, ".export", "adf", "projection.json");
  const text = await fs.readFile(p, "utf8").catch(() => {
    throw new Error(
      `sharepoint: no ADF projection, pass one in ctx.projection or run \`docsxai export adf\` first (looked at ${p})`,
    );
  });
  const parsed = JSON.parse(text) as unknown;
  if (!isProjection(parsed)) throw new Error(`sharepoint: ${p} is not an ADF projection`);
  return parsed;
}

async function readManifest(
  client: GraphClient,
  folder: string,
  log: PluginLogger,
): Promise<Manifest> {
  const files: Record<string, ManifestEntry> = Object.create(null) as Record<string, ManifestEntry>;
  const text = await client.readText(`${folder}/${MANIFEST_FILE}`);
  if (text === null) return { schema: MANIFEST_SCHEMA, files };
  const parsed = JSON.parse(text) as Partial<Manifest> | null;
  if (
    parsed === null ||
    parsed.schema !== MANIFEST_SCHEMA ||
    typeof parsed.files !== "object" ||
    parsed.files === null ||
    Array.isArray(parsed.files)
  ) {
    throw new Error(`sharepoint: ${folder}/${MANIFEST_FILE} is not a docsxai manifest`);
  }
  let dropped = 0;
  for (const [rel, value] of Object.entries(parsed.files)) {
    const entry = validEntry(value);
    if (entry) {
      files[rel] = entry;
      continue;
    }
    dropped++;
    if (dropped <= MAX_MANIFEST_WARNINGS) {
      log.warn(
        `manifest entry ${JSON.stringify(rel.slice(0, 80))} is not valid, uploading it again`,
      );
    }
  }
  if (dropped > MAX_MANIFEST_WARNINGS) {
    log.warn(
      `${dropped - MAX_MANIFEST_WARNINGS} more manifest entries are not valid, uploading them again`,
    );
  }
  return { schema: MANIFEST_SCHEMA, files };
}

function manifestJson(manifest: Manifest): string {
  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return `${JSON.stringify({ schema: manifest.schema, files }, null, 2)}\n`;
}

interface Upload {
  rel: string;
  data: Uint8Array;
  sha256: string;
  contentType: string;
}

/** Library-relative name of a document's page: the overview is `index`, a flow is its safe name. */
function pageName(doc: AdfDocument): string {
  return `${doc.section === "project" ? "index" : safeName(doc.section)}.md`;
}

function imageName(att: AdfAttachment): string {
  return `${IMAGES_DIR}/${safeName(att.fileName)}`;
}

/**
 * Refuses two documents or two screenshots that would land on one file. SharePoint names are case
 * insensitive and `safeName` folds spaces and punctuation, so `a b` and `a-b` (or `Login` and
 * `login`) are one path. A screenshot named twice with the same source is one file, not a clash.
 * Runs before any request, so a collision never leaves a half-written folder behind.
 */
function assertNoCollisions(documents: readonly AdfDocument[], folder: string): void {
  const pages = new Map<string, string>();
  const images = new Map<string, { source: string; section: string; fileName: string }>();
  for (const doc of documents) {
    const rel = pageName(doc);
    const prior = pages.get(rel.toLowerCase());
    if (prior !== undefined) {
      throw new Error(
        `sharepoint: sections ${JSON.stringify(prior)} and ${JSON.stringify(doc.section)} both publish to ${folder}/${rel}`,
      );
    }
    pages.set(rel.toLowerCase(), doc.section);
    for (const att of doc.attachments) {
      const key = imageName(att).toLowerCase();
      const known = images.get(key);
      const source = `${att.fileName}\0${att.sourcePath}`;
      if (known !== undefined && known.source !== source) {
        throw new Error(
          `sharepoint: screenshots ${JSON.stringify(known.fileName)} (section ${JSON.stringify(known.section)}) and ${JSON.stringify(att.fileName)} (section ${JSON.stringify(doc.section)}) both upload to ${folder}/${imageName(att)}`,
        );
      }
      images.set(key, { source, section: doc.section, fileName: att.fileName });
    }
  }
}

/** Everything one document publishes: the page file and its screenshots, keyed by library-relative path. */
async function uploadsFor(
  workspaceDir: string,
  doc: AdfDocument,
  title: string,
): Promise<{ page: Upload; images: Upload[] }> {
  const markdown = Buffer.from(`${titleLine(title)}\n\n${adfToMarkdown(doc.adf)}\n`, "utf8");
  const images: Upload[] = [];
  for (const att of doc.attachments) {
    // The projection can come from a caller, so the path is held inside the workspace and the
    // hash is taken from the bytes read, not from `att.sha256`.
    const data = await readRegularFile(
      await resolveWorkspacePathReal(workspaceDir, att.sourcePath),
    );
    images.push({
      rel: imageName(att),
      data,
      sha256: sha256Hex(data),
      contentType: "image/png",
    });
  }
  const page = {
    rel: pageName(doc),
    data: markdown,
    sha256: sha256Hex(markdown),
    contentType: "text/markdown",
  };
  return { page, images };
}

export function createSharePointPublisher(
  options: SharePointPublisherOptions = {},
): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "SHAREPOINT_TOKEN";
      const token = process.env[tokenVar];
      if (!token) throw new Error(`sharepoint: missing bearer token, set ${tokenVar}`);

      const mask = maskToken(token);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(mask(m)),
        warn: (m) => ctx.log.warn(mask(m)),
        error: (m) => ctx.log.error(mask(m)),
      };

      try {
        const config = parseConfig(ctx.config, options);
        const projection = await loadProjection(ctx);
        assertNoCollisions(projection.documents, config.folder);
        const root = config.drive_id
          ? `drives/${encodeURIComponent(config.drive_id)}`
          : `sites/${encodeURIComponent(config.site_id!)}/drive`;
        const client = new GraphClient(config.graph_base_url, { root }, token, mask, options);
        const manifest = await readManifest(client, config.folder, log);

        const sent = new Set<string>();
        const push = async (u: Upload): Promise<boolean> => {
          const known = manifest.files[u.rel];
          if (!config.force && known?.sha256 === u.sha256) return false;
          if (sent.has(u.rel)) return false;
          const item = await client.upload(`${config.folder}/${u.rel}`, u.data, u.contentType);
          sent.add(u.rel);
          manifest.files[u.rel] = {
            sha256: u.sha256,
            size: u.data.byteLength,
            ...(typeof item.id === "string" && item.id.length <= 256 ? { id: item.id } : {}),
            ...(isSharePointUrl(item.webUrl) ? { webUrl: item.webUrl } : {}),
          };
          return true;
        };

        const pages: PublishResult["pages"] = [];
        let failure: { error: unknown } | undefined;
        try {
          for (const doc of projection.documents) {
            const title = `${config.title_prefix ?? ""}${doc.title}`;
            const { page, images } = await uploadsFor(ctx.workspaceDir, doc, title);
            const existed = manifest.files[page.rel] !== undefined;
            let wrote = false;
            for (const image of images) wrote = (await push(image)) || wrote;
            wrote = (await push(page)) || wrote;
            const entry = manifest.files[page.rel]!;
            const action = !wrote ? "unchanged" : existed ? "updated" : "created";
            log.info(`section "${doc.section}": ${action} (${config.folder}/${page.rel})`);
            pages.push({
              id: entry.id ?? `${config.folder}/${page.rel}`,
              ...(entry.webUrl ? { url: entry.webUrl } : {}),
              action,
              section: doc.section,
            });
          }
        } catch (e) {
          failure = { error: e };
        }
        // The manifest still records what was uploaded before a failure. A failed manifest write
        // is logged and the error that stopped the push is the one reported.
        if (sent.size > 0) {
          try {
            const body = Buffer.from(manifestJson(manifest), "utf8");
            await client.upload(`${config.folder}/${MANIFEST_FILE}`, body, "application/json");
          } catch (e) {
            if (!failure) throw e;
            log.error(`manifest write failed: ${(e as Error).message}`);
          }
        }
        if (failure) throw failure.error;

        return {
          ok: true,
          target: `sharepoint:${root}/${config.folder}`,
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
