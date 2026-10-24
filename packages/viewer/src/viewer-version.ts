// The viewer's own name and version, stamped into the footer of every emitted page and printed by
// `docsxai-viewer --version`. It is a build constant: the same pack rendered twice by one install
// gives byte-identical pages.

import { readFileSync } from "node:fs";

/** `package.json` sits one level above both `src/` and `dist/`. */
function readPackage(): { name?: unknown; version?: unknown } {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
  } catch {
    return {};
  }
}

/** `@docsxai/viewer <version>`, or the bare name when the package file can't be read. */
export function viewerStamp(): string {
  const { name, version } = readPackage();
  if (typeof name === "string" && typeof version === "string") return `${name} ${version}`;
  return "@docsxai/viewer";
}

/** The version in the viewer's `package.json`, or `unknown`. */
export function viewerVersion(): string {
  const { version } = readPackage();
  return typeof version === "string" ? version : "unknown";
}
