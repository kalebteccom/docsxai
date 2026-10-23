// burnAnnotations for a script: the caption theme comes from the workspace's `.docsxai.json`, read
// once per workspace and kept for the process.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnnotationRecord } from "./annotations.js";
import { burnAnnotations, type BurnOptions } from "./burn.js";
import { loadBurnTheme, WORKSPACE_CONFIG_FILE, type LoadedTheme } from "./burn-theme-load.js";

export interface BurnWithWorkspaceThemeInput {
  /** A docsxai workspace directory; its `.docsxai.json` holds the `burn.theme` block. */
  workspace: string;
  screenshotBuffer: Buffer;
  /** `docsxai/annotations@1`-shaped records for ONE screenshot. */
  annotations: AnnotationRecord[];
  /** Forwarded to `burnAnnotations`. An explicit `theme` wins over the workspace's. */
  options?: BurnOptions;
}

/** Loads by workspace path and config mtime; a promise, so concurrent calls share one load. */
const cache = new Map<string, Promise<LoadedTheme | undefined>>();

/** Forgets every loaded theme. For tests. */
export function clearWorkspaceThemeCache(): void {
  cache.clear();
}

async function configMtime(workspace: string): Promise<string> {
  try {
    return String((await fs.stat(path.join(workspace, WORKSPACE_CONFIG_FILE))).mtimeMs);
  } catch {
    return "none";
  }
}

async function themeOf(
  workspace: string,
  warn: (message: string) => void,
): Promise<LoadedTheme | undefined> {
  const root = path.resolve(workspace);
  const key = `${root}\0${await configMtime(root)}`;
  let loading = cache.get(key);
  if (loading === undefined) {
    loading = loadBurnTheme(root).then((loaded) => {
      for (const w of loaded?.warnings ?? []) warn(w);
      return loaded;
    });
    cache.set(key, loading);
    // A failed load is not kept: fixing the file gives a new mtime, and a transient error retries.
    loading.catch(() => {
      if (cache.get(key) === loading) cache.delete(key);
    });
  }
  return loading;
}

/**
 * Burns `annotations` onto the screenshot with the workspace's `burn.theme` (today's look when it
 * has none) and returns what `burnAnnotations` returns. The theme's warnings go to `options.warn`
 * (default console.warn) once per load. Throws BurnThemeError, naming the file and every bad key,
 * when the block is invalid.
 */
export async function burnWithWorkspaceTheme(input: BurnWithWorkspaceThemeInput): Promise<Buffer> {
  const options = input.options ?? {};
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const loaded = options.theme === undefined ? await themeOf(input.workspace, warn) : undefined;
  return burnAnnotations({
    screenshotBuffer: input.screenshotBuffer,
    annotations: input.annotations,
    options: { ...options, ...(loaded ? { theme: loaded.theme } : {}) },
  });
}
