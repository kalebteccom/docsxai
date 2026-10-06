// Publish config and secrets for `guru:push`.

import {
  assertGuruBaseUrl,
  DEFAULT_GURU_URL,
  type GuruUrlOptions,
  ID_PATTERN,
} from "./guru-client.js";

export type ShareStatus = "TEAM" | "PRIVATE";

export interface GuruPublishConfig {
  /** Collection the cards are created in. */
  collection_id: string;
  /**
   * Guru API endpoint. The default, `https://api.getguru.com/api/v1`, is the only value accepted:
   * https on `api.getguru.com` with that path.
   */
  base_url: string;
  /** Prefixed onto every card title. */
  title_prefix?: string;
  /** `TEAM` (default) lets the collection's members see the cards; `PRIVATE` keeps them to the token's user. */
  share_status: ShareStatus;
  /** Write every card even when the manifest says it is unchanged. */
  force?: boolean;
  /** Id of the manifest card; skips the search that finds it by title. */
  manifest_card_id?: string;
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optionalId(raw: Record<string, unknown>, key: string): string | undefined {
  const v = optionalString(raw, key);
  if (v !== undefined && !ID_PATTERN.test(v)) {
    throw new Error(`guru: config.${key} is not a usable id`);
  }
  return v;
}

export function parseConfig(
  raw: Record<string, unknown>,
  options: GuruUrlOptions = {},
): GuruPublishConfig {
  const collection = optionalId(raw, "collection_id");
  if (!collection) throw new Error("guru: config.collection_id is required");
  const share = optionalString(raw, "share_status") ?? "TEAM";
  if (share !== "TEAM" && share !== "PRIVATE") {
    throw new Error("guru: config.share_status must be TEAM or PRIVATE");
  }
  const prefix = optionalString(raw, "title_prefix");
  const manifestId = optionalId(raw, "manifest_card_id");
  return {
    collection_id: collection,
    base_url: assertGuruBaseUrl(optionalString(raw, "base_url") ?? DEFAULT_GURU_URL, options),
    share_status: share,
    ...(prefix ? { title_prefix: prefix } : {}),
    ...(raw["force"] === true ? { force: true } : {}),
    ...(manifestId ? { manifest_card_id: manifestId } : {}),
  };
}

/** Replaces every occurrence of a secret with a placeholder. Longer, composite secrets go first. */
export function maskSecrets(
  secrets: Array<{ value: string; placeholder: string }>,
): (message: string) => string {
  const ordered = secrets.filter((s) => s.value.length > 0);
  return (message) => ordered.reduce((m, s) => m.replaceAll(s.value, s.placeholder), message);
}
