// Emptying the generated folders of a site before a re-emit. A flow that left the pack, or whose
// page slug changed, would otherwise keep its old page and images in the project: Starlight builds
// every page under `src/content/docs`, so the old flow stays on the site and in its search index.
// Only the two folders the emitter owns are touched: flow pages and flow images.

import { promises as fs } from "node:fs";
import * as path from "node:path";

const GENERATED_DIRS = ["src/content/docs/flows", "src/assets/flows"];

async function walk(dir: string, base: string): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = `${base}/${e.name}`;
    if (e.isDirectory()) {
      const inner = await walk(path.join(dir, e.name), rel);
      files.push(...inner.files);
      dirs.push(...inner.dirs, rel);
    } else files.push(rel);
  }
  return { files, dirs };
}

/**
 * Removes what an earlier emit left under the generated folders and this emit does not write
 * (`keep`: POSIX paths relative to `outDir`), then the folders that end up empty. Returns the
 * removed files.
 */
export async function pruneStale(outDir: string, keep: ReadonlySet<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const root of GENERATED_DIRS) {
    const { files, dirs } = await walk(path.join(outDir, root), root);
    for (const rel of files.sort()) {
      if (keep.has(rel)) continue;
      await fs.rm(path.join(outDir, rel), { force: true });
      removed.push(rel);
    }
    // Deepest first, so a folder emptied by the loop above goes before its parent is tried.
    for (const rel of dirs.sort().reverse()) {
      await fs.rmdir(path.join(outDir, rel)).catch(() => undefined);
    }
  }
  return removed;
}
