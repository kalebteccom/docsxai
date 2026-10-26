// Operator-only settings for the wiki-push strategy. Which publisher code runs, which env vars it
// is handed and which hosts a config URL may name all come from the backend's environment, never
// from a webhook config (any bearer holder can write one) or the materialised workspace.

import * as fs from "node:fs";
import * as path from "node:path";

/** Publisher plugin directories, absolute, separated by `path.delimiter`. */
export const PLUGIN_DIRS_ENV = "DOCSX_BACKEND_PLUGIN_DIRS";
/** Comma-separated https origins a `plugin_config` URL may point at. */
export const PUBLISHER_ORIGINS_ENV = "DOCSX_BACKEND_PUBLISHER_ORIGINS";
/** Comma-separated env var names passed to the publisher as `secretsEnv`. */
export const PUBLISHER_ENV_ENV = "DOCSX_BACKEND_PUBLISHER_ENV";

/** `plugin_config` keys checked as URLs: `url`, `base_url`, `graph_base_url`, ... */
const URL_KEY_RE = /(^|_)url$/;

const csv = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const originOf = (o: string): string => {
  try {
    return new URL(o).origin;
  } catch {
    return "";
  }
};

/** The configured plugin dirs. Throws on a relative entry. */
export function pluginDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = (env[PLUGIN_DIRS_ENV] ?? "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    if (!path.isAbsolute(d)) throw new Error(`${PLUGIN_DIRS_ENV} entries must be absolute: ${d}`);
  }
  return dirs;
}

/** Real path of the plugin's `register` module; throws when it leaves the plugin dir. */
export function registerModulePath(dir: string, register: string): string {
  const root = fs.realpathSync(dir);
  const entry = fs.realpathSync(path.resolve(root, register));
  if (!entry.startsWith(root + path.sep)) {
    throw new Error(`${dir}: register "${register}" resolves outside the plugin directory`);
  }
  return entry;
}

/**
 * Why `plugin_config` is refused, or undefined. `sources` is never accepted, and every URL-valued
 * key must be an https URL without credentials on an origin in `DOCSX_BACKEND_PUBLISHER_ORIGINS`.
 */
export function pluginConfigProblem(
  config: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!config) return undefined;
  if ("sources" in config) {
    return `plugin_config.sources is not accepted: publisher directories come from ${PLUGIN_DIRS_ENV} on the backend`;
  }
  const origins = new Set(csv(env[PUBLISHER_ORIGINS_ENV]).map(originOf));
  for (const [key, value] of Object.entries(config)) {
    if (!URL_KEY_RE.test(key)) continue;
    const field = `plugin_config.${key}`;
    let u: URL;
    try {
      u = new URL(String(value));
    } catch {
      return `${field} is not a valid URL`;
    }
    if (u.protocol !== "https:") return `${field} must be an https URL`;
    if (u.username || u.password) return `${field} must not contain credentials`;
    if (!origins.has(u.origin)) {
      return `${field} origin ${u.origin} is not in ${PUBLISHER_ORIGINS_ENV}`;
    }
  }
  return undefined;
}

/** The env vars named in `DOCSX_BACKEND_PUBLISHER_ENV` that are set. */
export function publisherSecretsEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of csv(env[PUBLISHER_ENV_ENV])) {
    const v = env[name];
    if (typeof v === "string") out[name] = v;
  }
  return out;
}
