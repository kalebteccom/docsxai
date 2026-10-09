#!/usr/bin/env node
// scripts/audit-package-contents.mjs
//
// Runs `npm pack --dry-run --json` per workspace package and asserts the
// to-be-published tarball does not contain forbidden patterns. Wired to a
// dedicated CI gate so a regression is caught before any publish path
// (the root workspace is `private: true` and is skipped — only the
// shippable sub-packages are audited).
//
// Forbidden contents (per universal-baseline §F, npm-package-defense §3.4):
//
//   - Any dotfile / dot-directory other than the explicit allowlist
//     (.env, .git, .github, .vscode, .idea, .claude, .DS_Store, etc).
//   - node_modules — should never end up in a tarball, but if `"files"` is
//     loosened a careless commit can pull it in.
//   - Tests, fixtures, coverage — `*.test.{js,ts}`, `*.spec.{js,ts}`,
//     `__tests__/`, `__fixtures__/`, `coverage/`, `.nyc_output/`.
//   - Sourcemaps (`*.map`) — leak verbatim source via sourcesContent.
//   - Secrets-shaped filenames — `.netrc`, `id_rsa*`, `*.pem`, `*.key`,
//     `credentials.json`, `secrets.json`.
//   - Anything > 1 MB unless explicitly allowlisted.
//
// Lifecycle-script check: each `package.json` must not declare any of
//   preinstall / install / postinstall / preuninstall / uninstall / postuninstall
// These run on the adopter's machine on `npm install` — every confirmed npm
// supply-chain compromise of the last two years has used one. `prepare` and
// `prepublishOnly` are publisher-side or build-only and remain allowed.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_PATTERNS, missingPaths, requiredPaths } from "./package-audit-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
];

// Files > 1 MB raise a flag unless their path is explicitly in this list.
// Empty for docsxai today; populate explicitly when a legitimate large asset
// (icon set, model weights, etc) ships intentionally.
const LARGE_FILE_ALLOWLIST = new Set([]);
const MAX_UNALLOWLISTED_BYTES = 1024 * 1024; // 1 MB

function runNpmPack(cwd) {
  // Use npm (ships with Node) — we do NOT want pnpm-pack semantics here; we
  // want the exact list npm would publish.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // npm pack --json emits an array of tarball-meta objects (one per package).
  return JSON.parse(out);
}

function inspectPackageJson(cwd) {
  const path = resolve(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const errors = [];
  const scripts = pkg.scripts ?? {};
  for (const banned of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    if (banned in scripts) {
      errors.push(
        `package.json declares forbidden lifecycle script "${banned}" — runs on adopter \`npm install\`. Remove it.`,
      );
    }
  }
  return { pkg, errors };
}

function auditTarball(cwd, label, pkg) {
  const errors = [];
  let tarballs;
  try {
    tarballs = runNpmPack(cwd);
  } catch (err) {
    return {
      label,
      errors: [
        `npm pack --dry-run failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  for (const tarball of tarballs) {
    const files = tarball.files ?? [];
    const missing = missingPaths(
      files.map((f) => f.path ?? ""),
      requiredPaths(cwd, pkg),
    );
    for (const m of missing) {
      errors.push(
        `${label}: required path "${m}" is missing from the tarball. Check "files" in package.json (and that the build ran).`,
      );
    }
    for (const f of files) {
      const path = f.path ?? "";
      const size = typeof f.size === "number" ? f.size : 0;

      for (const { pattern, why } of FORBIDDEN_PATTERNS) {
        if (pattern.test(path)) {
          errors.push(`${label}: forbidden path "${path}" — ${why}`);
        }
      }

      if (size > MAX_UNALLOWLISTED_BYTES && !LARGE_FILE_ALLOWLIST.has(path)) {
        errors.push(
          `${label}: oversized file "${path}" (${size} bytes > 1 MB). If intentional, add to LARGE_FILE_ALLOWLIST in scripts/audit-package-contents.mjs.`,
        );
      }
    }
  }

  return { label, errors };
}

function main() {
  // Root workspace is `private: true` — never published; skipped.
  // Each shippable sub-package is audited independently.
  const packageDirs = ["backend", "docsxai", "engine", "plugin", "skill", "viewer"];

  const targets = [];
  for (const dir of packageDirs) {
    const cwd = resolve(REPO_ROOT, "packages", dir);
    if (!existsSync(resolve(cwd, "package.json"))) continue;
    const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
    targets.push({ cwd, label: pkg.name ?? `packages/${dir}`, pkg });
  }

  const allErrors = [];
  for (const { cwd, label, pkg } of targets) {
    // Lifecycle-script gate (applies to every published manifest).
    const { errors: pkgErrors } = inspectPackageJson(cwd);
    for (const e of pkgErrors) allErrors.push(`${label}: ${e}`);

    // Tarball-content gate.
    const { errors: tarErrors } = auditTarball(cwd, label, pkg);
    allErrors.push(...tarErrors);
  }

  if (allErrors.length > 0) {
    console.error("Package-contents audit failed:");
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Package-contents audit passed.");
}

main();
