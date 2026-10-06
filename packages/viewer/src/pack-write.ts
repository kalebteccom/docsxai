// Writes a built pack into its output directory and removes what the previous manifest listed
// and the new one does not. Removal is by exact path: the directory is never scanned, so a file
// nobody listed (notes, another tool's output) is never touched.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PACK_MANIFEST_FILE, fileOfSrc } from "./pack-schema.js";

export interface WritePackOptions {
  outDir: string;
  /** `<flow>/<step>.<hash8>.png` → bytes. */
  files: Map<string, Buffer>;
  manifestText: string;
}

export interface WritePackResult {
  /** Relative paths written (new or changed), manifest included. */
  written: string[];
  /** Relative paths removed. */
  removed: string[];
}

const MAX_DEPTH = 8;

/** Every `variants[*].src` in a manifest of any shape (`flows` or v1 `screens`), as `<dir>/<file>`. */
export function listedFiles(manifest: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH || typeof manifest !== "object" || manifest === null) return [];
  const found: string[] = [];
  const record = manifest as Record<string, unknown>;
  const variants = record.variants;
  if (typeof variants === "object" && variants !== null && !Array.isArray(variants)) {
    for (const v of Object.values(variants)) {
      const src = (v as { src?: unknown } | null)?.src;
      const file = typeof src === "string" ? fileOfSrc(src) : null;
      if (file) found.push(file);
    }
  }
  for (const value of Object.values(record)) found.push(...listedFiles(value, depth + 1));
  return found;
}

async function previousManifest(outDir: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(outDir, PACK_MANIFEST_FILE), "utf8"));
  } catch {
    return null;
  }
}

function inside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`path escapes the output directory: ${relative}`);
  }
  return target;
}

export async function writePack(opts: WritePackOptions): Promise<WritePackResult> {
  const { outDir, files } = opts;
  const written: string[] = [];
  const removed: string[] = [];
  const stale = [...new Set(listedFiles(await previousManifest(outDir)))].filter(
    (f) => !files.has(f),
  );
  for (const [relative, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const target = inside(outDir, relative);
    const existing = await fs.readFile(target).catch(() => null);
    if (existing?.equals(bytes)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    written.push(relative);
  }
  await fs.mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, PACK_MANIFEST_FILE);
  const current = await fs.readFile(manifestPath, "utf8").catch(() => null);
  if (current !== opts.manifestText) {
    await fs.writeFile(manifestPath, opts.manifestText);
    written.push(PACK_MANIFEST_FILE);
  }
  for (const relative of stale.sort()) {
    const target = inside(outDir, relative);
    const gone = await fs.unlink(target).then(
      () => true,
      () => false,
    );
    if (!gone) continue;
    removed.push(relative);
    await fs.rmdir(path.dirname(target)).catch(() => {});
  }
  return { written, removed };
}
