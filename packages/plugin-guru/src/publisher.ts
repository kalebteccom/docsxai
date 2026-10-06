// Guru publisher: the only Guru egress path in the docsxai tree.
//
// Consumes the engine's ADF projection (`docsxai export adf`), renders each document to HTML and
// creates or updates one card per document in a Guru collection, with its screenshots uploaded as
// Guru-hosted attachments and embedded in the card. Page identity is the section name, mapped to
// a card id in the manifest card (see manifest.ts).
//
// Idempotency: the manifest records the content hash of every card and the hash and hosted URL of
// every image. A push uploads only images whose bytes changed, writes only cards whose rendered
// content, title, share status or collection changed, and writes the manifest only when something
// was written. An unchanged pack costs a search, a read of the manifest card and zero writes. The
// manifest is written last, so a push that fails midway is redone for the missing parts.
//
// The user email and token are read from the environment variables named in `secretsEnv.email` and
// `secretsEnv.token` and are masked in every error and log line.

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
import { adfToHtml, safeName } from "./adf-html.js";
import { type GuruPublishConfig, maskSecrets, parseConfig } from "./config.js";
import {
  type CardBody,
  GuruClient,
  type GuruClientOptions,
  type GuruUrlOptions,
} from "./guru-client.js";
import {
  cardUrl,
  emptyManifest,
  type Manifest,
  MANIFEST_TITLE,
  manifestToHtml,
  parseManifestHtml,
} from "./manifest.js";
import { readRegularFile } from "./read-file.js";

/** Options of the publisher itself, not of a publish call. */
export type GuruPublisherOptions = GuruUrlOptions & GuruClientOptions;

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
      `guru: no ADF projection, pass one in ctx.projection or run \`docsxai export adf\` first (looked at ${p})`,
    );
  });
  const parsed = JSON.parse(text) as unknown;
  if (!isProjection(parsed)) throw new Error(`guru: ${p} is not an ADF projection`);
  return parsed;
}

interface LoadedManifest {
  manifest: Manifest;
  /** Id of the card holding it, when one exists. */
  cardId?: string;
}

/** The manifest card: pinned by `manifest_card_id`, else the one card with the manifest title. */
async function loadManifest(
  client: GuruClient,
  config: GuruPublishConfig,
  log: PluginLogger,
): Promise<LoadedManifest> {
  let cardId = config.manifest_card_id;
  if (!cardId) {
    const hits = (await client.searchCards(MANIFEST_TITLE)).filter(
      (c) => c.preferredPhrase === MANIFEST_TITLE && c.collection?.id === config.collection_id,
    );
    if (hits.length > 1) {
      throw new Error(
        `guru: ${hits.length} cards titled "${MANIFEST_TITLE}" in the collection, delete the extra ones or set config.manifest_card_id`,
      );
    }
    cardId = hits[0]?.id;
  }
  if (!cardId) return { manifest: emptyManifest() };
  const card = await client.getCard(cardId);
  if (!card) {
    if (config.manifest_card_id) throw new Error(`guru: manifest card ${cardId} does not exist`);
    return { manifest: emptyManifest() };
  }
  if (card.collection?.id !== config.collection_id) {
    throw new Error(`guru: manifest card ${cardId} is not in collection ${config.collection_id}`);
  }
  const manifest = parseManifestHtml(
    card.content ?? "",
    (m) => log.warn(m),
    `manifest card ${cardId}`,
  );
  return { manifest, cardId };
}

interface Image {
  name: string;
  data: Uint8Array;
  sha256: string;
}

/** A document's screenshots, read from inside the workspace and hashed as read. */
async function readImages(workspaceDir: string, doc: AdfDocument): Promise<Image[]> {
  const images: Image[] = [];
  for (const att of doc.attachments) {
    // The projection can come from a caller, so the path is held inside the workspace and the
    // hash is taken from the bytes read, not from `att.sha256`.
    const data = await readRegularFile(
      await resolveWorkspacePathReal(workspaceDir, att.sourcePath),
    );
    images.push({ name: safeName(att.fileName), data, sha256: sha256Hex(data) });
  }
  return images;
}

export function createGuruPublisher(options: GuruPublisherOptions = {}): PublisherPlugin {
  return {
    async publish(ctx: PublisherContext): Promise<PublishResult> {
      const tokenVar = ctx.secretsEnv["token"] ?? "GURU_USER_TOKEN";
      const emailVar = ctx.secretsEnv["email"] ?? "GURU_USER_EMAIL";
      const token = process.env[tokenVar];
      const email = process.env[emailVar];
      if (!token) throw new Error(`guru: missing user token, set ${tokenVar}`);
      if (!email) throw new Error(`guru: missing user email, set ${emailVar}`);

      const mask = maskSecrets([
        {
          value: Buffer.from(`${email}:${token}`).toString("base64"),
          placeholder: "<GURU_BASIC_AUTH>",
        },
        { value: token, placeholder: "<GURU_USER_TOKEN>" },
        { value: email, placeholder: "<GURU_USER_EMAIL>" },
      ]);
      const log: PluginLogger = {
        info: (m) => ctx.log.info(mask(m)),
        warn: (m) => ctx.log.warn(mask(m)),
        error: (m) => ctx.log.error(mask(m)),
      };

      try {
        const config = parseConfig(ctx.config, options);
        const projection = await loadProjection(ctx);
        const client = new GuruClient(config.base_url, email, token, mask, options);
        const { manifest, cardId: manifestCardId } = await loadManifest(client, config, log);

        const cardBody = (title: string, html: string): CardBody => ({
          preferredPhrase: title,
          content: html,
          shareStatus: config.share_status,
          collection: { id: config.collection_id },
        });

        let dirty = false;
        const pages: PublishResult["pages"] = [];
        let failure: { error: unknown } | null = null;
        try {
          for (const doc of projection.documents) {
            const title = `${config.title_prefix ?? ""}${doc.title}`;
            const key = doc.section === "project" ? "index" : safeName(doc.section);

            const links = new Map<string, string>();
            for (const image of await readImages(ctx.workspaceDir, doc)) {
              const known = manifest.images[image.name];
              if (!config.force && known?.sha256 === image.sha256) {
                links.set(image.name, known.link);
                continue;
              }
              const link = await client.uploadAttachment(image.name, image.data, "image/png");
              manifest.images[image.name] = {
                sha256: image.sha256,
                size: image.data.byteLength,
                link,
              };
              links.set(image.name, link);
              dirty = true;
            }

            const html = adfToHtml(doc.adf, (name) => links.get(name));
            const sha256 = sha256Hex(
              JSON.stringify([title, config.share_status, config.collection_id, html]),
            );
            const known = manifest.pages[key];
            if (!config.force && known?.sha256 === sha256) {
              log.info(`section "${doc.section}": unchanged (card ${known.cardId})`);
              pages.push({
                id: known.cardId,
                ...(known.url ? { url: known.url } : {}),
                action: "unchanged",
                section: doc.section,
              });
              continue;
            }

            let existing = known ? await client.getCard(known.cardId) : null;
            // The card id comes from a manifest anyone with edit rights on that card can change, so a
            // card is only updated when it is in the target collection and is not the manifest itself.
            if (
              existing &&
              known &&
              (existing.collection?.id !== config.collection_id || existing.id === manifestCardId)
            ) {
              log.warn(
                `section "${doc.section}": card ${known.cardId} is not a page in collection ${config.collection_id}, creating a new card`,
              );
              existing = null;
            }
            const body = cardBody(title, html);
            const card = existing
              ? await client.updateCard(existing.id, {
                  ...body,
                  // An update without tags removes them, so the card's own come back unchanged.
                  ...(existing.tags ? { tags: existing.tags } : {}),
                })
              : await client.createCard(body);
            const url = cardUrl(card.slug);
            manifest.pages[key] = { cardId: card.id, sha256, ...(url ? { url } : {}) };
            dirty = true;
            const action = existing ? "updated" : "created";
            log.info(`section "${doc.section}": ${action} (card ${card.id})`);
            pages.push({
              id: card.id,
              ...(url ? { url } : {}),
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
            const body = cardBody(MANIFEST_TITLE, manifestToHtml(manifest));
            if (manifestCardId) {
              await client.updateCard(manifestCardId, body);
            } else {
              const created = await client.createCard(body);
              log.info(
                `manifest card ${created.id} created, set config.manifest_card_id to skip the search for it`,
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
          target: `guru:collection/${config.collection_id}`,
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
