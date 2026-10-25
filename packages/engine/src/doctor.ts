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
import { commandUsage, usageError } from "./cli-messages.js";
import { engineVersion } from "./cli-version.js";
import { doctorNextStep } from "./doctor-next.js";
import { parseCommandFlags } from "./cli-flags.js";

// Re-export the probe catalogue's public surface so importers keep reaching it
// through ./doctor.js (its original home) — no importer or test changes. The
// plugin-runtime probe lives in its own sibling but is re-exported here too.
export * from "./doctor-checks.js";
export * from "./doctor-checks-plugins.js";
export * from "./doctor-checks-config.js";
export { doctorNextStep } from "./doctor-next.js";

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
    // A config that does not load already failed the workspace row; the plugins row would repeat it.
    if (ws.check.ok) checks.push(...(await checkPlugins(workspaceDir)));
  }

  checks.push(await checkViewer(env));
  checks.push(...checkEnv(env));
  return checks;
}

const oneLine = (t: string): string => t.replace(/\s+/g, " ").trim();

/** What the closing line suggests after a failure. */
const FAILED_NEXT = "fix the fail lines above, then run docsxai doctor again";

export interface DoctorFormatOptions {
  /** The docsxai version, printed as the first row when given. */
  version?: string;
  /** The command the passing summary line suggests; omitted from the line when absent. */
  next?: string;
}

/** One `ok:` or `fail:` line per check, then one summary line. Plain ASCII, no colour, no timings. */
export function formatDoctorChecks(checks: DoctorCheck[], opts: DoctorFormatOptions = {}): string {
  let out = opts.version === undefined ? "" : `ok: version: docsxai ${opts.version}\n`;
  for (const c of checks) {
    out += `${c.ok ? "ok" : "fail"}: ${c.name}: ${oneLine(c.detail)}`;
    if (c.fix) out += ` next: ${oneLine(c.fix)}`;
    out += "\n";
  }
  const failed = checks.filter((c) => !c.ok).length;
  const infos = checks.filter((c) => c.info).length;
  const scored = checks.length - infos;
  const next = opts.next === undefined ? "" : ` next: ${opts.next}`;
  out +=
    failed === 0
      ? `ok: doctor: all checks passed (${scored} checks, ${infos} informational)${next}\n`
      : `fail: doctor: ${failed} of ${scored} checks failed next: ${FAILED_NEXT}\n`;
  return out;
}

/** The schema id of `doctor --format json`. */
export const DOCTOR_JSON_SCHEMA = "docsxai/doctor@1";

/** One check in `doctor --format json`. Every key is always present. */
export interface DoctorJsonCheck {
  name: string;
  ok: boolean;
  info: boolean;
  detail: string;
  next: string | null;
}

/** What `doctor --format json` prints. Every key is always present, in this order. */
export interface DoctorJsonReport {
  schema: typeof DOCTOR_JSON_SCHEMA;
  version: string;
  ok: boolean;
  checks: DoctorJsonCheck[];
  /** The suggested command after a pass, the fix-and-rerun hint after a failure, or null. */
  next: string | null;
}

/** The `doctor --format json` document for `checks`. */
export function doctorReport(
  checks: DoctorCheck[],
  opts: { version: string; next?: string },
): DoctorJsonReport {
  const ok = checks.every((c) => c.ok);
  return {
    schema: DOCTOR_JSON_SCHEMA,
    version: opts.version,
    ok,
    checks: checks.map((c) => ({
      name: c.name,
      ok: c.ok,
      info: c.info === true,
      detail: oneLine(c.detail),
      next: c.fix ? oneLine(c.fix) : null,
    })),
    next: ok ? (opts.next ?? null) : FAILED_NEXT,
  };
}

/** What `docsxai doctor --help` prints: the usage line from `docsxai --help`, then what the rows mean. */
export function doctorHelp(): string {
  return `${commandUsage("doctor")
    .map((l) => `usage: ${l}\n`)
    .join("")}
Checks Node, Chromium, the workspace config (fields and burn.theme shape), write access, flow-files,
cached sessions, a HEAD to app_url, the backend and login state (when backend_url is set), plugin
declarations and lock, the viewer and environment settings. Runs no flow, no plugin code and no browser.

  ok: <check>: <detail> next: <what to do>     passed (next is present when there is a follow-up)
  fail: <check>: <detail> next: <what to do>   failed

  --offline        do not probe app_url
  --format json    one JSON document (schema docsxai/doctor@1) instead of the lines

Exit 0 when no line starts with fail:, 1 otherwise.
`;
}

/** `docsxai doctor [<workspace-dir>]` — returns the process exit code. */
export async function runDoctor(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(doctorHelp());
    return 0;
  }
  const parsed = parseCommandFlags("doctor", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  const format = flags.get("format") ?? "text";
  if (format !== "text" && format !== "json") {
    return usageError("doctor", "--format must be text or json");
  }
  const dirArg = positionals[0] || undefined;
  const checks = await buildDoctorChecks({
    ...(dirArg ? { workspaceDir: dirArg } : {}),
    offline: flags.get("offline") === true,
  });
  const version = engineVersion();
  const next = await doctorNextStep(dirArg, dirArg ?? process.cwd());
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(doctorReport(checks, { version, next }), null, 2)}\n`
      : formatDoctorChecks(checks, { version, next }),
  );
  return checks.every((c) => c.ok) ? 0 : 1;
}
