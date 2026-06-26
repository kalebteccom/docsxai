// `docsxai doctor` — environment + workspace health-check.
//
// Prints a ✓/✗ checklist with a one-line fix per failing check (− marks purely
// informational rows; they never fail doctor). Exits 0 iff everything passes,
// 1 otherwise. Pure inspection throughout: no flow runs, no plugin code
// execution, no browser launch — the only network touch is an opt-in GET of
// the configured backend's /v1/health.
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
import { checkPlugins } from "./doctor-checks-plugins.js";

// Re-export the probe catalogue's public surface so importers keep reaching it
// through ./doctor.js (its original home) — no importer or test changes. The
// plugin-runtime probe lives in its own sibling but is re-exported here too.
export * from "./doctor-checks.js";
export * from "./doctor-checks-plugins.js";

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
    checks.push(await checkFlows(workspaceDir));
    checks.push(...(await checkAuth(workspaceDir, now)));
    checks.push(await checkBackend(workspaceDir, ws.config, env, fetchImpl));
    checks.push(...(await checkPlugins(workspaceDir)));
  }

  checks.push(await checkViewer(env));
  checks.push(...checkEnv(env));
  return checks;
}

export function formatDoctorChecks(checks: DoctorCheck[]): string {
  let out = "docsxai doctor — environment & workspace health\n\n";
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    const glyph = c.info ? "−" : c.ok ? "✓" : "✗";
    out += `  ${glyph} ${c.name.padEnd(10)} ${c.detail}\n`;
    if (!c.ok && c.fix) out += `    fix: ${c.fix}\n`;
  }
  out += `\n${allOk ? "all checks passed" : "fix the ✗ items above"}\n`;
  return out;
}

/** `docsxai doctor [<workspace-dir>]` — returns the process exit code. */
export async function runDoctor(args: string[]): Promise<number> {
  const positionals = args.filter((a) => !a.startsWith("--"));
  const checks = await buildDoctorChecks(positionals[0] ? { workspaceDir: positionals[0] } : {});
  process.stdout.write(formatDoctorChecks(checks));
  return checks.every((c) => c.ok) ? 0 : 1;
}
