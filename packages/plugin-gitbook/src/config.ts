// Publish config and secrets for `gitbook:push`.

import { singleLine } from "./adf-markdown.js";
import {
  assertGitBookBaseUrl,
  DEFAULT_GITBOOK_URL,
  type GitBookUrlOptions,
  ID_PATTERN,
} from "./gitbook-client.js";

export interface GitBookPublishConfig {
  /** Space the pages go into. */
  space_id: string;
  /**
   * GitBook API endpoint. The default, `https://api.gitbook.com/v1`, is the only value accepted:
   * https on `api.gitbook.com` with that path.
   */
  base_url: string;
  /** Page the new pages are created under; the space's top level when absent. */
  parent_page_id?: string;
  /** Prefixed onto every page title. */
  title_prefix?: string;
  /** Write every page even when the manifest says it is unchanged. */
  force?: boolean;
  /** Id of the manifest page; skips the search that finds it by title. */
  manifest_page_id?: string;
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optionalId(raw: Record<string, unknown>, key: string): string | undefined {
  const v = optionalString(raw, key);
  if (v !== undefined && !ID_PATTERN.test(v)) {
    throw new Error(`gitbook: config.${key} is not a usable id`);
  }
  return v;
}

export function parseConfig(
  raw: Record<string, unknown>,
  options: GitBookUrlOptions = {},
): GitBookPublishConfig {
  const space = optionalId(raw, "space_id");
  if (!space) throw new Error("gitbook: config.space_id is required");
  const parent = optionalId(raw, "parent_page_id");
  const manifest = optionalId(raw, "manifest_page_id");
  const prefix = singleLine(optionalString(raw, "title_prefix") ?? "");
  return {
    space_id: space,
    base_url: assertGitBookBaseUrl(optionalString(raw, "base_url") ?? DEFAULT_GITBOOK_URL, options),
    ...(parent ? { parent_page_id: parent } : {}),
    ...(prefix ? { title_prefix: prefix } : {}),
    ...(raw["force"] === true ? { force: true } : {}),
    ...(manifest ? { manifest_page_id: manifest } : {}),
  };
}

/** Replaces every occurrence of the token with a placeholder. */
export function maskToken(token: string): (message: string) => string {
  return (message) => (token ? message.replaceAll(token, "<GITBOOK_TOKEN>") : message);
}
