// `docsxai doctor` — the site row. A workspace with an emitted site folder (`docsxai site`
// writes `<workspace>/site` by default) that has no astro installed cannot build with
// `npm run build`; the row says to install there first. No site folder, or astro present,
// adds no row.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { shellQuote } from "./cli-messages.js";
import type { DoctorCheck } from "./doctor-checks.js";

/** The row for `<workspaceDir>/site`, or `null` when there is nothing to say. */
export function checkSite(workspaceDir: string): DoctorCheck | null {
  const dir = path.join(workspaceDir, "site");
  const emitted =
    existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "astro.config.mjs"));
  if (!emitted || existsSync(path.join(dir, "node_modules", "astro", "package.json"))) return null;
  return {
    name: "site",
    ok: true,
    info: true,
    detail: `${dir} has no astro installed`,
    fix: `cd ${shellQuote(dir)} && npm install, then npm run build`,
  };
}
