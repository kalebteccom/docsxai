// `docsxai doctor` — environment + workspace health-check.
//
// Prints one `ok:` or `fail:` line per check, each with a `next:` step where there is one.
// Exits 0 iff no line failed, 1 otherwise. Pure inspection throughout: no flow runs, no plugin
// code execution, no browser launch. The network touches are a short HEAD of `app_url`
// (skipped with --offline) and a GET of the configured backend's /v1/health.
//
// The per-check probe catalogue lives in ./doctor-checks.js; this file owns the
// checklist assembly + CLI entry and re-exports the checks' public surface so
// every doctor symbol stays importable from ./doctor.js.

import {
  checkAuth,
  checkBackend,
  checkChromium,
  checkEnv,
  checkFlows,
  checkNode,
  checkViewer,
  checkWorkspace,
  probeChromium,
  type DoctorCheck,
  type DoctorOptions,
} from "./doctor-checks.js";
import {
  checkAppUrl,
  checkConfigFields,
  checkLogin,
  checkWritable,
} from "./doctor-checks-config.js";
import { checkPlugins } from "./doctor-checks-plugins.js";
import { commandUsage } from "./cli-messages.js";

// Re-export the probe catalogue's public surface so importers keep reaching it
// through ./doctor.js (its original home) — no importer or test changes. The
// plugin-runtime probe lives in its own sibling but is re-exported here too.
export * from "./doctor-checks.js";
export * from "./doctor-checks-plugins.js";
export * from "./doctor-checks-config.js";

// ---------------------------------------------------------------------------
// Assembly + CLI entry
// ---------------------------------------------------------------------------

export async function buildDoctorChecks(opts: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const workspaceDir = opts.workspaceDir ?? process.cwd();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const checks: DoctorCheck[] = [];
  checks.push(checkNode(opts.nodeVersion ?? process.versions.node));
  checks.push(await checkChromium(opts.chromiumProbe ?? probeChromium));

  const ws = await checkWorkspace(workspaceDir);
  checks.push(ws.check);
  if (ws.present) {
    checks.push(...checkConfigFields(ws.config));
    checks.push(await checkWritable(workspaceDir));
    checks.push(await checkFlows(workspaceDir));
    checks.push(...(await checkAuth(workspaceDir, now)));
    const appUrl = await checkAppUrl(ws.config, fetchImpl, opts.offline ?? false);
    if (appUrl) checks.push(appUrl);
    checks.push(await checkBackend(workspaceDir, ws.config, env, fetchImpl));
    checks.push(checkLogin(workspaceDir, ws.config, env));
    checks.push(...(await checkPlugins(workspaceDir)));
  }

  checks.push(await checkViewer(env));
  checks.push(...checkEnv(env));
  return checks;
}

const oneLine = (t: string): string => t.replace(/\s+/g, " ").trim();

/** One `ok:` or `fail:` line per check, then one summary line. Plain ASCII, no colour, no timings. */
export function formatDoctorChecks(checks: DoctorCheck[]): string {
  let out = "";
  for (const c of checks) {
    out += `${c.ok ? "ok" : "fail"}: ${c.name}: ${oneLine(c.detail)}`;
    if (c.fix) out += ` next: ${oneLine(c.fix)}`;
    out += "\n";
  }
  const failed = checks.filter((c) => !c.ok).length;
  const infos = checks.filter((c) => c.info).length;
  const scored = checks.length - infos;
  out +=
    failed === 0
      ? `ok: doctor: all checks passed (${scored} checks, ${infos} informational) next: docsxai run <workspace-dir>\n`
      : `fail: doctor: ${failed} of ${scored} checks failed next: fix the fail lines above, then run docsxai doctor again\n`;
  return out;
}

/** What `docsxai doctor --help` prints: the usage line from `docsxai --help`, then what the rows mean. */
export function doctorHelp(): string {
  return `${commandUsage("doctor")
    .map((l) => `usage: ${l}\n`)
    .join("")}
Checks Node, Chromium, the workspace config (fields and burn.theme shape), write access, flow-files,
cached sessions, a HEAD to app_url, the backend and login state (when backend_url is set), plugin
declarations and lock, the viewer bin and DOCSX_* env. Runs no flow, no plugin code and no browser.

  ok: <check>: <detail> next: <what to do>     passed (next is present when there is a follow-up)
  fail: <check>: <detail> next: <what to do>   failed

  --offline   do not probe app_url

Exit 0 when no line starts with fail:, 1 otherwise.
`;
}

/** `docsxai doctor [<workspace-dir>]` — returns the process exit code. */
export async function runDoctor(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(doctorHelp());
    return 0;
  }
  const positionals = args.filter((a) => !a.startsWith("--"));
  const checks = await buildDoctorChecks({
    ...(positionals[0] ? { workspaceDir: positionals[0] } : {}),
    offline: args.includes("--offline"),
  });
  process.stdout.write(formatDoctorChecks(checks));
  return checks.every((c) => c.ok) ? 0 : 1;
}
