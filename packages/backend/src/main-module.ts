// Entry-point check for the bin. `process.argv[1]` keeps the path the shell used, so a bin that
// npm or pnpm installed as a symlink never equals `import.meta.url`, which Node resolves to the
// real file. Comparing the real path as well makes the bin start through its symlink.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  if (metaUrl === pathToFileURL(argv1).href) return true;
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
