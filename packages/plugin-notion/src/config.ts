// Publish config and secrets for `notion:push`.

import {
  assertNotionBaseUrl,
  DEFAULT_NOTION_URL,
  normalizeId,
  type NotionUrlOptions,
  type Parent,
} from "./notion-client.js";

export interface NotionPublishConfig {
  /** Where pages are created: under a page, or as rows of a database. */
  parent: Parent;
  /** Name of the database's title property. Only used with a database parent. */
  title_property: string;
  /**
   * Notion API endpoint. The default, `https://api.notion.com/v1`, is the only value accepted:
   * https on `api.notion.com` with that path.
   */
  base_url: string;
  /** Prefixed onto every page title. */
  title_prefix?: string;
  /** Write every page even when the manifest says it is unchanged. */
  force?: boolean;
  /** Id of the manifest page; skips the lookup that finds it by title. */
  manifest_page_id?: string;
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optionalId(raw: Record<string, unknown>, key: string): string | undefined {
  const v = optionalString(raw, key);
  if (v === undefined) return undefined;
  const id = normalizeId(v);
  if (id === null) throw new Error(`notion: config.${key} is not a Notion id`);
  return id;
}

export function parseConfig(
  raw: Record<string, unknown>,
  options: NotionUrlOptions = {},
): NotionPublishConfig {
  const page = optionalId(raw, "parent_page_id");
  const database = optionalId(raw, "database_id");
  if (page && database) {
    throw new Error("notion: set config.parent_page_id or config.database_id, not both");
  }
  if (!page && !database) {
    throw new Error("notion: config.parent_page_id or config.database_id is required");
  }
  const property = optionalString(raw, "title_property") ?? "Name";
  if (property.length > 200) throw new Error("notion: config.title_property is too long");
  const prefix = optionalString(raw, "title_prefix");
  const manifestId = optionalId(raw, "manifest_page_id");
  return {
    parent: page ? { type: "page_id", id: page } : { type: "database_id", id: database! },
    title_property: property,
    base_url: assertNotionBaseUrl(optionalString(raw, "base_url") ?? DEFAULT_NOTION_URL, options),
    ...(prefix ? { title_prefix: prefix } : {}),
    ...(raw["force"] === true ? { force: true } : {}),
    ...(manifestId ? { manifest_page_id: manifestId } : {}),
  };
}

/** Replaces every occurrence of the token with a placeholder. */
export function maskToken(token: string): (message: string) => string {
  return (message) => (token ? message.replaceAll(token, "<NOTION_TOKEN>") : message);
}
