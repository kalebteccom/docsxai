#!/usr/bin/env node
// scripts/pre-gate.mjs
//
// Cheap local checks on the files a branch changed, so CI does not find them first:
// prettier, eslint, tsc per touched package, single-file tests and the dash guard.
// It builds nothing and runs no full suite or browser.
//
//   node scripts/pre-gate.mjs [--base refs/remotes/origin/main]
//
// Changed files are `git diff --name-only --diff-filter=AM <base>...HEAD`, plus uncommitted and
// untracked files. Exit 1 when any check fails. A skipped check does not fail.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyEslint,
  eslintFiles,
  parseArgs,
  prettierFiles,
  splitNames,
  testPlan,
  typecheckPackages,
  UNVERIFIED_RULES,
  workspaceDepNames,
} from "./pre-gate-plan.mjs";

const INSTALL_HINT = "skipped: run pnpm install --offline --frozen-lockfile --ignore-scripts";
const MAX_BUFFER = 64 * 1024 * 1024;

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER });

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER });
  return {
    code: r.status ?? 1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    stdout: r.stdout ?? "",
  };
}

function chunks(list, size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Failure output: runners print the verdict last, so keep the tail when it is long.
const indent = (text, max = 40) => {
  const lines = text.split("\n");
  const shown = lines.slice(-max).map((l) => `    ${l}`);
  if (lines.length > max) shown.unshift(`    ... ${lines.length - max} earlier lines`);
  return shown.join("\n");
};

async function main() {
  const { base } = parseArgs(process.argv.slice(2));
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  const tool = (name) => {
    const bin = join(root, "node_modules", ".bin", name);
    return existsSync(bin) ? bin : null;
  };

  const committed = git(["diff", "--name-only", "-z", "--diff-filter=AM", `${base}...HEAD`], root);
  const dirty = git(["diff", "--name-only", "-z", "--diff-filter=AM", "HEAD"], root);
  const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"], root);
  const files = splitNames(committed, dirty, untracked).filter((f) => existsSync(join(root, f)));

  console.log(`pre-gate: ${files.length} changed files against ${base}`);

  const results = [];
  const report = (status, name, detail = "", body = "") => {
    results.push(status);
    console.log(`${status.padEnd(4)} ${name}${detail ? `: ${detail}` : ""}`);
    if (body) console.log(indent(body));
  };

  const packagesDir = join(root, "packages");
  const distMissing = readdirSync(packagesDir, { withFileTypes: true }).some(
    (d) =>
      d.isDirectory() &&
      existsSync(join(packagesDir, d.name, "package.json")) &&
      !existsSync(join(packagesDir, d.name, "dist")),
  );

  // (a) prettier
  const forPrettier = prettierFiles(files);
  const prettier = tool("prettier");
  if (forPrettier.length === 0) report("ok", "prettier", "no files");
  else if (!prettier) report("skip", "prettier", INSTALL_HINT);
  else {
    const bad = [];
    let failed = false;
    for (const batch of chunks(forPrettier)) {
      const r = run(prettier, ["--check", "--ignore-unknown", ...batch], root);
      if (r.code !== 0) {
        failed = true;
        bad.push(r.out);
      }
    }
    if (failed)
      report(
        "FAIL",
        "prettier",
        `${forPrettier.length} files, fix with npx prettier --write`,
        bad.join("\n"),
      );
    else report("ok", "prettier", `${forPrettier.length} files`);
  }

  // (b) eslint
  const forEslint = eslintFiles(files);
  const eslint = tool("eslint");
  if (forEslint.length === 0) report("ok", "eslint", "no files");
  else if (!eslint) report("skip", "eslint", INSTALL_HINT);
  else {
    const errors = [];
    const unverified = [];
    let broken = "";
    for (const batch of chunks(forEslint)) {
      const r = run(eslint, ["--no-warn-ignored", "--format", "json", ...batch], root);
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        broken = r.out || "eslint produced no JSON output";
        break;
      }
      const c = classifyEslint(parsed, { distMissing, root: `${root}/` });
      errors.push(...c.errors);
      unverified.push(...c.unverified);
    }
    if (broken) report("FAIL", "eslint", "did not run", broken);
    else if (errors.length)
      report(
        "FAIL",
        "eslint",
        `${errors.length} errors in ${forEslint.length} files`,
        errors.join("\n"),
      );
    else report("ok", "eslint", `${forEslint.length} files`);
    if (unverified.length) {
      console.log(`     unverified locally, CI decides: ${unverified.length} hits`);
      console.log(indent(unverified.join("\n"), 10));
    }
  }

  // (c) tsc per touched package
  const tsc = tool("tsc");
  const pkgDirs = typecheckPackages(files, (dir) => existsSync(join(root, dir, "tsconfig.json")));
  if (pkgDirs.length === 0) report("ok", "tsc", "no touched package");
  const names = new Map();
  for (const d of readdirSync(packagesDir, { withFileTypes: true })) {
    const manifest = join(packagesDir, d.name, "package.json");
    if (d.isDirectory() && existsSync(manifest))
      names.set(JSON.parse(readFileSync(manifest, "utf8")).name, `packages/${d.name}`);
  }
  for (const dir of pkgDirs) {
    const label = `tsc ${dir}`;
    if (!tsc || !existsSync(join(root, dir, "node_modules"))) {
      report("skip", label, INSTALL_HINT);
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
    const unbuilt = workspaceDepNames(manifest).filter(
      (dep) => names.has(dep) && !existsSync(join(root, names.get(dep), "dist")),
    );
    if (unbuilt.length) {
      report(
        "skip",
        label,
        `skipped: workspace deps not built (${unbuilt.join(", ")}), CI decides`,
      );
      continue;
    }
    const r = run(tsc, ["--noEmit", "-p", join(dir, "tsconfig.json")], root);
    if (r.code === 0) report("ok", label);
    else report("FAIL", label, "type errors", r.out);
  }

  // (d) single-file tests
  const websiteScripts = join(root, "website", "scripts");
  const websiteReady = existsSync(join(root, "website", "node_modules"));
  const guards =
    websiteReady && existsSync(websiteScripts)
      ? readdirSync(websiteScripts)
          .filter((n) => /^check-.*\.test\.mjs$/.test(n))
          .map((n) => `website/scripts/${n}`)
      : [];
  if (!websiteReady && files.some((f) => f.startsWith("website/"))) {
    report("skip", "website guards", INSTALL_HINT);
  }
  const plan = testPlan(files, guards);
  for (const { pkg, files: tests } of plan.vitest) {
    const label = `vitest ${pkg} (${tests.length})`;
    if (!existsSync(join(root, pkg, "node_modules"))) {
      report("skip", label, INSTALL_HINT);
    } else if (
      pkg === "packages/viewer" &&
      !existsSync(join(root, pkg, "dist", "generated", "overlay.js"))
    ) {
      report("skip", label, "skipped: viewer tests read a bundled overlay, CI decides");
    } else {
      const r = run(
        "npx",
        ["--no-install", "vitest", "run", "--testTimeout=30000", ...tests],
        join(root, pkg),
      );
      if (r.code === 0) report("ok", label);
      else report("FAIL", label, "", r.out);
    }
  }
  if (plan.node.length) {
    const r = run("node", ["--test", ...plan.node], root);
    if (r.code === 0) report("ok", `node --test (${plan.node.length})`);
    else report("FAIL", `node --test (${plan.node.length})`, plan.node.join(" "), r.out);
  } else if (plan.vitest.length === 0) {
    report("ok", "tests", "no changed test files, no website changes");
  }

  // (e) dashes: the repo guard owns the allowlist. It reads tracked files, so an untracked file is
  // checked once it is staged.
  const dash = run("node", ["--test", "scripts/no-dash-repo.test.mjs"], root);
  if (dash.code === 0) report("ok", "dashes", "no em or en dash outside the guard allowlist");
  else report("FAIL", "dashes", "", dash.out);

  if (distMissing) {
    console.log(
      `note: packages/*/dist is missing, so ${UNVERIFIED_RULES.map((r) => r.split("/").pop()).join(", ")} are unverified locally, CI decides.`,
    );
  }

  const failed = results.filter((r) => r === "FAIL").length;
  const skipped = results.filter((r) => r === "skip").length;
  const tail = skipped ? ` (${skipped} skipped)` : "";
  console.log(failed ? `FAIL${tail}: ${failed} checks failed` : `PASS${tail}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`pre-gate: ${err.message}`);
  process.exit(2);
});
