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
  type AdfDocument,
  type AdfProjection,
  type PluginLogger,
  type PublisherContext,
  type PublisherPlugin,
  type PublishResult,
  resolveWorkspacePath,
} from "@docsxai/engine";
import { adfToMarkdown, IMAGES_DIR, safeName } from "./adf-markdown.js";
import { DEFAULT_GRAPH_URL, GraphClient } from "./graph-client.js";

export const MANIFEST_FILE = "docsxai-manifest.json";
const MANIFEST_SCHEMA = "docsxai/sharepoint-manifest@1";

export interface SharePointPublishConfig {
  /** Document library id; takes precedence over `site_id`. */
  drive_id?: string;
  /** Site id; the site's default document library is used. */
  site_id?: string;
  /** Folder inside the library, no leading slash. Default `docsxai`. */
  folder: string;
  /** Graph endpoint. Default `https://graph.microsoft.com/v1.0`; override for sovereign clouds. */
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

export function parseConfig(raw: Record<string, unknown>): SharePointPublishConfig {
  const driveId = optionalString(raw, "drive_id");
  const siteId = optionalString(raw, "site_id");
  if (!driveId && !siteId) {
    throw new Error("sharepoint: config.drive_id or config.site_id is required");
  }
  const parts = (optionalString(raw, "folder") ?? "").split("/").filter(Boolean);
  const folder = parts.length > 0 ? parts : ["docsxai"];
  const prefix = optionalString(raw, "title_prefix");
  return {
    ...(driveId ? { drive_id: driveId } : {}),
    ...(siteId ? { site_id: siteId } : {}),
    folder: folder.map(safeName).join("/"),
    graph_base_url: (optionalString(raw, "graph_base_url") ?? DEFAULT_GRAPH_URL).replace(
      /\/+$/,
      "",
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

async function readManifest(client: GraphClient, folder: string): Promise<Manifest> {
  const text = await client.readText(`${folder}/${MANIFEST_FILE}`);
  if (text === null) return { schema: MANIFEST_SCHEMA, files: {} };
  const parsed = JSON.parse(text) as Partial<Manifest>;
  if (parsed.schema !== MANIFEST_SCHEMA || typeof parsed.files !== "object" || !parsed.files) {
    throw new Error(`sharepoint: ${folder}/${MANIFEST_FILE} is not a docsxai manifest`);
  }
  return { schema: MANIFEST_SCHEMA, files: parsed.files };
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

/** Everything one document publishes: the page file and its screenshots, keyed by library-relative path. */
async function uploadsFor(
  doc: AdfDocument,
  title: string,
): Promise<{ page: Upload; images: Upload[] }> {
  const markdown = Buffer.from(`# ${title}\n\n${adfToMarkdown(doc.adf)}\n`, "utf8");
  const name = doc.section === "project" ? "index" : safeName(doc.section);
  const images: Upload[] = [];
  for (const att of doc.attachments) {
    images.push({
      rel: `${IMAGES_DIR}/${safeName(att.fileName)}`,
      data: await fs.readFile(att.sourcePath),
      sha256: att.sha256,
      contentType: "image/png",
    });
  }
  const page = {
    rel: `${name}.md`,
    data: markdown,
    sha256: sha256Hex(markdown),
    contentType: "text/markdown",
  };
  return { page, images };
}

export function createSharePointPublisher(): PublisherPlugin {
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
        const config = parseConfig(ctx.config);
        const projection = await loadProjection(ctx);
        const root = config.drive_id
          ? `drives/${encodeURIComponent(config.drive_id)}`
          : `sites/${encodeURIComponent(config.site_id!)}/drive`;
        const client = new GraphClient(config.graph_base_url, { root }, token, mask);
        const manifest = await readManifest(client, config.folder);

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
            ...(item.id ? { id: item.id } : {}),
            ...(item.webUrl ? { webUrl: item.webUrl } : {}),
          };
          return true;
        };

        const pages: PublishResult["pages"] = [];
        try {
          for (const doc of projection.documents) {
            const title = `${config.title_prefix ?? ""}${doc.title}`;
            const { page, images } = await uploadsFor(doc, title);
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
        } finally {
          if (sent.size > 0) {
            const body = Buffer.from(manifestJson(manifest), "utf8");
            await client.upload(`${config.folder}/${MANIFEST_FILE}`, body, "application/json");
          }
        }

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
