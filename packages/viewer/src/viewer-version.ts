// The viewer's own name and version, stamped into the footer of every emitted page. It is a
// build constant: the same pack rendered twice by one install gives byte-identical pages.

import { readFileSync } from "node:fs";

/** `@docsxai/viewer <version>`; `package.json` sits one level above both `src/` and `dist/`. */
export function viewerStamp(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const { name, version } = JSON.parse(raw) as { name?: string; version?: string };
    if (typeof name === "string" && typeof version === "string") return `${name} ${version}`;
  } catch {
    // fall through to the generic stamp
  }
  return "@docsxai/viewer";
}
