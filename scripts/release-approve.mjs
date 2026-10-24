#!/usr/bin/env node
// Approve the seven staged npm versions of one release with the owner's 2FA.
// See RELEASING.md, "Staged mode". Run by the owner on a machine logged into npm.
//
//   node scripts/release-approve.mjs v0.3.0-rc.4                  list + print the commands, change nothing
//   node scripts/release-approve.mjs v0.3.0-rc.4 --approve        approve, asking for a code per package
//   node scripts/release-approve.mjs v0.3.0-rc.4 --approve --otp 123456 [--otp 654321 ...]
//
// The tag comes from the first argument or RELEASE_TAG. The package list and its order are read from
// scripts/release-publish.sh, so the two cannot drift. The script never reads or prints a token,
// never publishes, and never approves without a one-time code. A code reaches npm through the
// NPM_CONFIG_OTP environment variable of the child process, so it is not on a command line that `ps`
// shows to other users. Prefer the prompt over `--otp`, which sits in shell history and in `ps`.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TAG_RE = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const OTP_RE = /^\d{6,8}$/;

/** The `packages=( ... )` array of release-publish.sh, in publish order. */
export function parsePackages(scriptText) {
  const m = /^packages=\(\n([\s\S]*?)^\)/m.exec(scriptText);
  const list = m
    ? m[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : [];
  if (list.length === 0) throw new Error("no packages=( ... ) array found in release-publish.sh");
  return list;
}

export function readPackages(file = resolve(here, "release-publish.sh")) {
  return parsePackages(readFileSync(file, "utf8"));
}

/** Default `run`: spawn without a shell, return what the caller needs. */
export function defaultRun(cmd, args, env) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? r.error?.message ?? "",
  };
}

export function parseArgs(argv, env = {}) {
  const o = { tag: env.RELEASE_TAG ?? "", approve: false, dryRun: false, otps: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--approve") o.approve = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--otp") o.otps.push(argv[++i] ?? "");
    else if (a.startsWith("--otp=")) o.otps.push(a.slice(6));
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else o.tag = a;
  }
  if (o.approve && o.dryRun) throw new Error("--approve and --dry-run exclude each other");
  if (!TAG_RE.test(o.tag))
    throw new Error(`tag '${o.tag}' is not vX.Y.Z[-prerelease]; pass it or set RELEASE_TAG`);
  if (o.otps.some((c) => !OTP_RE.test(c))) throw new Error("--otp takes a 6 to 8 digit code");
  if (o.otps.length > 0 && !o.approve) throw new Error("--otp only makes sense with --approve");
  o.version = o.tag.slice(1);
  o.distTag = o.version.includes("-") ? "next" : "latest";
  return o;
}

function stageEntries(json) {
  const v = typeof json === "string" ? JSON.parse(json) : json;
  if (Array.isArray(v)) return v;
  for (const k of ["stages", "items", "data", "results"]) if (Array.isArray(v?.[k])) return v[k];
  return [];
}

const field = (e, ...names) => names.map((n) => e?.[n]).find((x) => x !== undefined && x !== null);

/** Picks the stage for `version` and `distTag` out of an `npm stage list --json` answer. */
export function findStage(json, version, distTag) {
  const hits = stageEntries(json).filter((e) => field(e, "version") === version);
  const tagOf = (e) => field(e, "tag", "distTag", "dist_tag", "dist-tag");
  const ok = hits.filter((e) => tagOf(e) === undefined || tagOf(e) === distTag);
  const pick = (e) => ({
    id: String(field(e, "id", "stageId", "stage_id", "stage") ?? ""),
    status: String(field(e, "status", "state") ?? "unknown").toLowerCase(),
  });
  if (hits.length === 0) return { problem: "missing" };
  if (ok.length === 0)
    return { problem: `wrong tag (${hits.map(tagOf).join(", ")}, want ${distTag})` };
  if (ok.length > 1) return { problem: `duplicated (${ok.map((e) => pick(e).id).join(", ")})` };
  return pick(ok[0]);
}

export function formatTable(header, rows) {
  const all = [header, ...rows];
  const w = header.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  return all
    .map((r) =>
      r
        .map((c, i) => String(c).padEnd(w[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const sanitize = (text, secrets) =>
  secrets.reduce((t, s) => (s ? t.split(s).join("***") : t), text);

/** `npm view pkg@version version` and the dist-tags, for the final table and the live checks. */
export function inspectLive(run, pkg, version, distTag) {
  const v = run("npm", ["view", `${pkg}@${version}`, "version"]);
  const live = v.status === 0 && v.stdout.trim() === version;
  let tagged = "-";
  if (live) {
    const t = run("npm", ["view", pkg, "dist-tags", "--json"]);
    try {
      tagged = JSON.parse(t.stdout)[distTag] ?? "(none)";
    } catch {
      tagged = "(unreadable)";
    }
  }
  return { live, tagged };
}

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const run = deps.run ?? defaultRun;
  const out = deps.out ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  let packages;
  let o;
  try {
    o = parseArgs(argv, env);
    packages = deps.packages ?? readPackages();
  } catch (e) {
    err(`release-approve: ${e.message}`);
    return 2;
  }
  const ask =
    deps.prompt ??
    (async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(q)).trim();
      } finally {
        rl.close();
      }
    });

  const rows = [];
  let blocked = false;
  let waiting = false;
  for (const pkg of packages) {
    const r = run("npm", ["stage", "list", pkg, "--json"]);
    let found;
    try {
      if (r.status !== 0) throw new Error(r.stderr.trim().split("\n")[0] || `exit ${r.status}`);
      found = findStage(r.stdout, o.version, o.distTag);
    } catch (e) {
      found = { problem: `npm stage list failed: ${e.message}` };
    }
    if (found.problem === "missing" && inspectLive(run, pkg, o.version, o.distTag).live) {
      rows.push({ pkg, id: "-", status: "already live" });
      continue;
    }
    if (found.problem) blocked = true;
    else if (found.status !== "ready") {
      blocked = true;
      waiting ||= found.status === "validating";
    }
    rows.push({ pkg, id: found.id ?? "-", status: found.problem ?? found.status });
  }
  out(
    formatTable(
      ["package", "version", "stage id", "status"],
      rows.map((r) => [r.pkg, o.version, r.id, r.status]),
    ),
  );

  if (blocked) {
    err(
      waiting
        ? "release-approve: a stage is still validating: wait and rerun. Nothing was approved."
        : "release-approve: refusing to continue: every package needs exactly one ready stage (or be live already). Nothing was approved.",
    );
    return 1;
  }
  const todo = rows.filter((r) => r.status === "ready");
  if (todo.length === 0) out("Nothing left to approve.");

  if (!o.approve) {
    out("\nDry run. After checking the table, approve in this order (a fresh code for each):");
    for (const r of todo) out(`npm stage approve ${r.id} --otp <code>   # ${r.pkg}`);
    out(`\nOr: node scripts/release-approve.mjs ${o.tag} --approve`);
    return 0;
  }
  if (todo.length > 0 && o.otps.length === 0 && !isTTY) {
    err(
      "release-approve: --approve needs a terminal to ask for codes, or --otp <code>. Nothing was approved.",
    );
    return 1;
  }

  let failed = false;
  for (const [i, r] of todo.entries()) {
    const otp =
      o.otps[i] ?? (isTTY ? await ask(`Code for ${r.pkg} (stage ${r.id}): `) : o.otps.at(-1));
    if (!OTP_RE.test(otp ?? "")) {
      err(`release-approve: no valid one-time code for ${r.pkg}.`);
      failed = true;
      break;
    }
    // The code goes to npm through the environment, never through argv.
    const a = run("npm", ["stage", "approve", r.id], { NPM_CONFIG_OTP: otp });
    if (a.status !== 0) {
      err(
        `release-approve: npm stage approve ${r.id} (${r.pkg}) failed:\n${sanitize(a.stderr || a.stdout, [otp]).trim()}`,
      );
      failed = true;
      break;
    }
    out(`approved ${r.pkg}@${o.version}`);
  }

  const final = packages.map((pkg) => ({ pkg, ...inspectLive(run, pkg, o.version, o.distTag) }));
  out(
    "\n" +
      formatTable(
        ["package", "version", "live", `${o.distTag} tag`],
        final.map((f) => [f.pkg, o.version, f.live ? "yes" : "no", f.tagged]),
      ),
  );
  if (failed) {
    out(
      `Live: ${
        final
          .filter((f) => f.live)
          .map((f) => f.pkg)
          .join(", ") || "none"
      }`,
    );
    out(
      `Still staged: ${
        final
          .filter((f) => !f.live)
          .map((f) => f.pkg)
          .join(", ") || "none"
      }`,
    );
    out(`Rerun the same command to finish; packages already live are skipped.`);
    return 1;
  }
  const bad = final.filter((f) => !f.live || f.tagged !== o.version);
  if (bad.length > 0) {
    err(
      `release-approve: verification failed for ${bad.map((f) => f.pkg).join(", ")} (registry may lag, check again shortly).`,
    );
    return 1;
  }
  out("All packages are live under the expected dist-tag.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
