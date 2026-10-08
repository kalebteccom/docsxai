// scripts/package-audit-rules.mjs
//
// The rules behind scripts/audit-package-contents.mjs, kept free of side effects so a test can
// import them: the forbidden-path patterns, and the files a packed tarball must contain.
//
// Why required files: `files: ["dist"]` once shipped @docsxai/plugin without commands/, skills/
// and .claude-plugin/, and @docsxai/skill without skill/. The forbidden-path check cannot see a
// file that is missing, so each package lists what its tarball must carry.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Match against tarball-relative paths (as `npm pack --json` lists them, with no `package/` prefix).
// Each entry is `{ pattern: RegExp, why: string }`.
export const FORBIDDEN_PATTERNS = [
  // Dotfiles / dot-directories — npm strips most by default, but a custom
  // "files" allowlist that hits a directory containing dotfiles ships them.
  { pattern: /(^|\/)\.env(\.|$)/, why: "dotenv file would leak credentials" },
  { pattern: /(^|\/)\.git(\/|$)/, why: ".git directory" },
  { pattern: /(^|\/)\.github(\/|$)/, why: ".github directory" },
  { pattern: /(^|\/)\.vscode(\/|$)/, why: ".vscode directory" },
  { pattern: /(^|\/)\.idea(\/|$)/, why: ".idea directory" },
  { pattern: /(^|\/)\.claude(\/|$)/, why: ".claude directory" },
  { pattern: /(^|\/)\.DS_Store$/, why: "OS cruft" },
  { pattern: /(^|\/)\.cursor(\/|$)/, why: ".cursor directory" },
  { pattern: /(^|\/)\.codex(\/|$)/, why: ".codex directory" },
  { pattern: /(^|\/)\.agents(\/|$)/, why: ".agents directory" },

  // Workspace cruft.
  { pattern: /(^|\/)node_modules(\/|$)/, why: "node_modules must never be published" },
  { pattern: /(^|\/)coverage(\/|$)/, why: "coverage output" },
  { pattern: /(^|\/)\.nyc_output(\/|$)/, why: "nyc coverage cache" },
  { pattern: /(^|\/)artifacts(\/|$)/, why: "investigation artifacts" },

  // Tests / fixtures.
  { pattern: /\.test\.(js|ts|tsx|mjs|cjs)$/, why: "test file" },
  { pattern: /\.spec\.(js|ts|tsx|mjs|cjs)$/, why: "spec file" },
  { pattern: /(^|\/)__tests__(\/|$)/, why: "__tests__ directory" },
  { pattern: /(^|\/)__fixtures__(\/|$)/, why: "__fixtures__ directory" },
  { pattern: /(^|\/)tests?(\/|$)/, why: "tests directory" },

  // Sourcemaps — leak verbatim source via sourcesContent.
  { pattern: /\.map$/, why: "sourcemap leaks src/" },

  // Secret-shaped filenames.
  { pattern: /(^|\/)\.npmrc$/, why: ".npmrc may carry auth tokens" },
  { pattern: /(^|\/)\.netrc$/, why: ".netrc carries credentials" },
  { pattern: /(^|\/)id_rsa/, why: "SSH private key" },
  { pattern: /\.pem$/, why: "PEM-encoded credential" },
  { pattern: /\.key$/, why: "key file" },
  { pattern: /(^|\/)credentials\.json$/, why: "credentials file" },
  { pattern: /(^|\/)secrets\.json$/, why: "secrets file" },

  // Browser-session captures.
  { pattern: /\.storageState\.json$/, why: "captured browser auth state" },
  { pattern: /(^|\/)\.auth(\/|$)/, why: ".auth directory carries session state" },
];

const stripDot = (p) => p.replace(/^\.\//, "");

function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
}

/**
 * The tarball-relative paths the package at `cwd` must contain: its `main` and every `bin` target,
 * plus, for the plugin, `.claude-plugin/plugin.json` and every `commands/*.md` and
 * `skills/<name>/SKILL.md` in the source tree, and for the skill bundle `skill/docsxai/SKILL.md`.
 * @param {string} cwd package directory
 * @param {{ name?: string, main?: string, bin?: string | Record<string, string> }} pkg parsed package.json
 * @returns {string[]}
 */
export function requiredPaths(cwd, pkg) {
  const required = [];
  if (typeof pkg.main === "string") required.push(stripDot(pkg.main));
  const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
  for (const b of bins) required.push(stripDot(b));

  if (pkg.name === "@docsxai/plugin") {
    required.push(".claude-plugin/plugin.json");
    for (const e of listDir(join(cwd, "commands"))) {
      if (e.isFile() && e.name.endsWith(".md")) required.push(`commands/${e.name}`);
    }
    for (const e of listDir(join(cwd, "skills"))) {
      if (e.isDirectory() && existsSync(join(cwd, "skills", e.name, "SKILL.md"))) {
        required.push(`skills/${e.name}/SKILL.md`);
      }
    }
  }
  if (pkg.name === "@docsxai/skill") required.push("skill/docsxai/SKILL.md");
  return [...new Set(required)];
}

/**
 * The required paths that the packed file list lacks.
 * @param {string[]} packed tarball-relative paths
 * @param {string[]} required
 * @returns {string[]}
 */
export function missingPaths(packed, required) {
  const have = new Set(packed.map(stripDot));
  return required.filter((p) => !have.has(p));
}
