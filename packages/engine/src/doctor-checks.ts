// `docsxai doctor` — the per-check probe catalogue.
//
// One pure(ish) function per row of the doctor checklist, each over injectable inputs (a workspace
// dir, an env source, a fake backend, a mocked chromium probe) so per-state coverage is cheap.
// `doctor.ts` orchestrates these into the printed checklist. Pure inspection throughout: no flow
// runs, no plugin code execution, no browser launch — the only network touch is the opt-in GET of
// the configured backend's /v1/health.

import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { parseAuthStrategyFile } from "./auth.js";
import { FlowFileError, parseFlowFile } from "./flow-file.js";
import { chromiumExecutablePath } from "./playwright-driver.js";
import { resolveViewerBin, VIEWER_BIN_ENV, VIEWER_BIN_NAME, VIEWER_PACKAGE } from "./viewer-bin.js";
import { resolveWorkspacePath, WORKSPACE_CONFIG_FILE } from "./workspace.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  /** Informational row — printed with − instead of ✓/✗; never fails doctor. */
  info?: boolean;
}

export interface DoctorOptions {
  /** Workspace dir to inspect. Default: the current working directory. */
  workspaceDir?: string;
  /** Env source (tests inject). Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Node version under test (tests inject). Default `process.versions.node`. */
  nodeVersion?: string;
  /** Chromium probe override (tests inject; the real probe asks playwright-core). */
  chromiumProbe?: () => Promise<{ ok: boolean; detail: string }>;
  /** fetch override for the backend health probe (tests inject). */
  fetchImpl?: typeof globalThis.fetch;
  /** Clock override for session-freshness checks (tests inject). */
  now?: number;
}

const CHROMIUM_FIX =
  "npx playwright-core install chromium  (source checkout: pnpm -C packages/engine exec playwright-core install chromium)";

/** Layer-3 default probe: does playwright-core have a cached Chromium binary?
 *  Synchronous - the sole work is the sanctioned `chromiumExecutablePath()`
 *  helper (a sync `executablePath()` + `existsSync`), no IO to await. */
export function probeChromium(): { ok: boolean; detail: string } {
  try {
    // Goes through playwright-driver's helper — the one sanctioned playwright-core entry point —
    // so doctor doesn't open a second import site for the SDK.
    const p = chromiumExecutablePath();
    if (p) return { ok: true, detail: p };
    return { ok: false, detail: "playwright-core has no Chromium binary cached" };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual checks (exported for per-state unit tests)
// ---------------------------------------------------------------------------

export function checkNode(nodeVersion: string): DoctorCheck {
  const major = Number(nodeVersion.split(".")[0]);
  if (Number.isFinite(major) && major >= 26) {
    return { name: "node", ok: true, detail: `v${nodeVersion} (>= 26 required)` };
  }
  return {
    name: "node",
    ok: false,
    detail: `v${nodeVersion} — the engine requires Node >= 26`,
    fix: "upgrade Node (https://nodejs.org); the engine's `engines` field pins >= 26",
  };
}

export async function checkChromium(
  probe: () => { ok: boolean; detail: string } | Promise<{ ok: boolean; detail: string }>,
): Promise<DoctorCheck> {
  const r = await probe();
  return r.ok
    ? { name: "chromium", ok: true, detail: r.detail }
    : { name: "chromium", ok: false, detail: r.detail, fix: CHROMIUM_FIX };
}

interface WorkspaceProbe {
  check: DoctorCheck;
  /** Parsed `.docsxai.json` when valid (doctor reads the raw JSON — schema-checked here). */
  config: Record<string, unknown> | null;
  /** True when the dir looks like a workspace at all (config file or flows/ present). */
  present: boolean;
}

export async function checkWorkspace(workspaceDir: string): Promise<WorkspaceProbe> {
  const configPath = path.join(path.resolve(workspaceDir), WORKSPACE_CONFIG_FILE);
  const text = await readTextIfExists(configPath);
  const flowsDirExists = existsSync(path.join(path.resolve(workspaceDir), "flows"));
  if (text === null) {
    return {
      check: {
        name: "workspace",
        ok: true,
        info: true,
        detail: flowsDirExists
          ? `flows/ present but no ${WORKSPACE_CONFIG_FILE} at ${workspaceDir} — \`docsxai init\` writes one`
          : `no ${WORKSPACE_CONFIG_FILE} at ${workspaceDir} — not a docsxai workspace (pass <workspace-dir> or run doctor from one); workspace checks skipped`,
      },
      config: null,
      present: flowsDirExists,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      check: {
        name: "workspace",
        ok: false,
        detail: `${configPath} is not valid JSON: ${(e as Error).message}`,
        fix: `fix the JSON (or re-scaffold with \`docsxai init ${workspaceDir} --force\`)`,
      },
      config: null,
      present: true,
    };
  }
  const cfg = raw as Record<string, unknown>;
  if (cfg?.schema !== "docsxai/workspace@1") {
    return {
      check: {
        name: "workspace",
        ok: false,
        detail: `${configPath} has schema "${String(cfg?.schema)}" — expected "docsxai/workspace@1"`,
        fix: `set "schema": "docsxai/workspace@1" (or re-scaffold with \`docsxai init\`)`,
      },
      config: null,
      present: true,
    };
  }
  const appUrl = typeof cfg.app_url === "string" ? cfg.app_url : undefined;
  return {
    check: {
      name: "workspace",
      ok: true,
      detail: `${configPath} (docsxai/workspace@1${appUrl ? `, app_url ${appUrl}` : ", no app_url"})`,
    },
    config: cfg,
    present: true,
  };
}

export async function checkFlows(workspaceDir: string): Promise<DoctorCheck> {
  const flowsDir = path.join(path.resolve(workspaceDir), "flows");
  let entries: string[];
  try {
    entries = (await fs.readdir(flowsDir)).filter((e) => e.endsWith(".flow.yaml")).sort();
  } catch {
    return {
      name: "flows",
      ok: false,
      detail: `no flows/ directory at ${flowsDir}`,
      fix: `\`docsxai init\` scaffolds it; flows live at flows/<name>.flow.yaml`,
    };
  }
  if (entries.length === 0) {
    return {
      name: "flows",
      ok: true,
      info: true,
      detail: "flows/ is empty — calibrate one, or hand-author flows/<name>.flow.yaml",
    };
  }
  for (const entry of entries) {
    const p = path.join(flowsDir, entry);
    try {
      parseFlowFile(await fs.readFile(p, "utf8"), entry);
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      return {
        name: "flows",
        ok: false,
        detail: `${entry} does not parse: ${msg}`,
        fix: `fix the flow-file (then \`docsxai lint ${workspaceDir}\` for the full static report)`,
      };
    }
  }
  return {
    name: "flows",
    ok: true,
    detail: `${entries.length} flow-file(s) parse`,
  };
}

export async function checkAuth(workspaceDir: string, now: number): Promise<DoctorCheck[]> {
  const descriptorPath = resolveWorkspacePath(workspaceDir, "auth", "strategy.yaml");
  const text = await readTextIfExists(descriptorPath);
  if (text === null) {
    return [
      {
        name: "auth",
        ok: true,
        info: true,
        detail: "no auth/strategy.yaml — flows run with a fresh, unauthenticated context",
      },
    ];
  }
  let descriptor;
  try {
    descriptor = parseAuthStrategyFile(text, descriptorPath);
  } catch (e) {
    return [
      {
        name: "auth",
        ok: false,
        detail: (e as Error).message.replace(/\n\s*/g, " "),
        fix: "fix auth/strategy.yaml against the descriptor schema (docsxai/auth-strategy@1)",
      },
    ];
  }
  const role = descriptor.default_role;
  const roles = Object.keys(descriptor.roles).join(", ");
  const checks: DoctorCheck[] = [
    {
      name: "auth",
      ok: true,
      detail: `auth/strategy.yaml ok — role(s) ${roles} (default "${role}", strategy ${descriptor.roles[role]!.strategy})`,
    },
  ];
  // Cached-session freshness for the default role (the one `run` loads).
  const sessionPath = resolveWorkspacePath(workspaceDir, ".auth", `${role}.json`);
  const sessionText = await readTextIfExists(sessionPath);
  if (sessionText === null) {
    checks.push({
      name: "auth",
      ok: true,
      info: true,
      detail: `no cached session for role "${role}" — \`docsxai capture-auth ${workspaceDir}\` before \`run\``,
    });
    return checks;
  }
  let expiresAt: number | undefined;
  try {
    const parsed = JSON.parse(sessionText) as { expiresAt?: unknown };
    expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined;
  } catch {
    expiresAt = undefined;
  }
  if (expiresAt === undefined) {
    checks.push({
      name: "auth",
      ok: false,
      detail: `cached session ${sessionPath} is corrupt (no expiresAt)`,
      fix: `re-capture: docsxai capture-auth ${workspaceDir}`,
    });
  } else if (expiresAt <= now) {
    checks.push({
      name: "auth",
      ok: false,
      detail: `cached session for role "${role}" expired ${new Date(expiresAt).toISOString()}`,
      fix: `re-capture: docsxai capture-auth ${workspaceDir}`,
    });
  } else {
    checks.push({
      name: "auth",
      ok: true,
      detail: `cached session for role "${role}" valid until ${new Date(expiresAt).toISOString()}`,
    });
  }
  return checks;
}

export async function checkBackend(
  workspaceDir: string,
  config: Record<string, unknown> | null,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof globalThis.fetch,
): Promise<DoctorCheck> {
  const backendUrl = typeof config?.backend_url === "string" ? config.backend_url : undefined;
  if (!backendUrl) {
    return {
      name: "backend",
      ok: true,
      info: true,
      detail: "no backend_url configured — the workspace operates fully locally",
    };
  }
  // Token presence is a note, not a gate — /v1/health is unauthenticated.
  const tokenNote = env.DOCSX_TOKEN
    ? "token: DOCSX_TOKEN set"
    : existsSync(path.join(path.resolve(workspaceDir), ".auth", "backend-token.json"))
      ? "token: OAuth tokens at .auth/backend-token.json"
      : "no token — push/pull need DOCSX_TOKEN or `docsxai login --oauth`";
  const base = backendUrl.replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return {
        name: "backend",
        ok: false,
        detail: `${base}/v1/health → HTTP ${res.status}`,
        fix: "the backend answered but is unhealthy — check its logs",
      };
    }
    return { name: "backend", ok: true, detail: `${base}/v1/health ok (${tokenNote})` };
  } catch (e) {
    return {
      name: "backend",
      ok: false,
      detail: `${base}/v1/health unreachable (${(e as Error).message})`,
      fix: "start the backend (or fix backend_url in .docsxai.json)",
    };
  }
}

export async function checkViewer(
  env: NodeJS.ProcessEnv,
  resolveFrom?: string[],
): Promise<DoctorCheck> {
  const resolution = await resolveViewerBin({
    env: env,
    ...(resolveFrom ? { resolveFrom } : {}),
  });
  if (resolution.source === "env") {
    return {
      name: "viewer",
      ok: true,
      detail: `$${VIEWER_BIN_ENV} → ${resolution.prefixArgs[0] ?? resolution.command} (layer 1: env override)`,
    };
  }
  if (resolution.source === "package") {
    return {
      name: "viewer",
      ok: true,
      detail: `${VIEWER_PACKAGE} installed next to the engine → ${resolution.prefixArgs[0]} (layer 2: installed package)`,
    };
  }
  // Layer 3 is "trust PATH" — resolveViewerBin doesn't verify it, so doctor does.
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, VIEWER_BIN_NAME);
    if (existsSync(candidate)) {
      return {
        name: "viewer",
        ok: true,
        detail: `\`${VIEWER_BIN_NAME}\` on PATH → ${candidate} (layer 3: PATH)`,
      };
    }
  }
  return {
    name: "viewer",
    ok: false,
    detail: `\`${VIEWER_BIN_NAME}\` not resolvable — tried $${VIEWER_BIN_ENV}, the installed ${VIEWER_PACKAGE} package, and PATH`,
    fix: `install ${VIEWER_PACKAGE} next to the engine (a global \`docsxai\` install ships it), or point ${VIEWER_BIN_ENV} at its bin script`,
  };
}

/** DOCSX_* env vars the docsxai packages read (engine + backend). */
export const KNOWN_DOCSX_ENV_VARS: ReadonlyArray<string> = [
  "DOCSX_TOKEN",
  "DOCSX_CACHE_KEY",
  "DOCSX_VIEWER_BIN",
  "DOCSX_ENGINE_BIN",
  "DOCSX_DATA_DIR",
  "DOCSX_OAUTH_AUTO_APPROVE",
  "DOCSX_WEBHOOK_SECRET",
];

export function checkEnv(env: NodeJS.ProcessEnv): DoctorCheck[] {
  const set = Object.keys(env)
    .filter((k) => k.startsWith("DOCSX_"))
    .sort();
  if (set.length === 0) {
    return [
      { name: "env", ok: true, info: true, detail: "no DOCSX_* variables set (defaults apply)" },
    ];
  }
  const checks: DoctorCheck[] = [];
  const known = set.filter((k) => KNOWN_DOCSX_ENV_VARS.includes(k));
  if (known.length > 0) {
    checks.push({ name: "env", ok: true, detail: `set: ${known.join(", ")}` });
  }
  const cacheKey = env.DOCSX_CACHE_KEY;
  if (cacheKey) {
    const decoded = Buffer.from(cacheKey, "base64");
    if (decoded.length !== 32) {
      checks.push({
        name: "env",
        ok: false,
        detail: `DOCSX_CACHE_KEY must decode to exactly 32 bytes (got ${decoded.length})`,
        fix: "regenerate: openssl rand -base64 32",
      });
    }
  }
  for (const k of set) {
    if (!KNOWN_DOCSX_ENV_VARS.includes(k)) {
      checks.push({
        name: "env",
        ok: false,
        detail: `${k} is not a DOCSX_* variable any docsxai package reads (typo?)`,
        fix: `unset it or fix the spelling — known: ${KNOWN_DOCSX_ENV_VARS.join(", ")}`,
      });
    }
  }
  return checks;
}
