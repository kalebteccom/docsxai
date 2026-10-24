// `docsxai doctor` - the workspace-config probes: field validity (including the `burn.theme`
// block's shape), write access, the `app_url` reachability HEAD and the backend login state.
// Split out of doctor-checks.ts to keep each module small. Pure inspection: the only network touch
// is one short HEAD against the operator's own `app_url`, skipped under `--offline` or when the
// machine has no network.
//
// The viewer's full `burn.theme` validator (values, tokens file, contrast) lives in
// `@docsxai/viewer`. The engine does not depend on that package, and importing it from here would
// couple the two, so doctor checks the block's shape and the preset name only and points at
// `docsxai burn`, which prints every problem and contrast warning.

import { existsSync, promises as fs, constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { redactUrl, redactUrlsIn, shellQuote } from "./cli-messages.js";
import type { DoctorCheck } from "./doctor-checks.js";
import { WORKSPACE_CONFIG_FILE } from "./workspace.js";

type Config = Record<string, unknown> | null;

const THEME_PRESETS = ["clean", "soft", "high-contrast", "readable"];
export const APP_URL_TIMEOUT_MS = 3000;

function httpUrlProblem(key: string, value: unknown): string | null {
  if (typeof value !== "string") return `${key} must be a string`;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return `${key} must start with http:// or https://`;
    }
  } catch {
    return `${key} is not a valid URL`;
  }
  return null;
}

function themeProblems(burn: unknown): string[] {
  if (typeof burn !== "object" || burn === null || Array.isArray(burn)) {
    return ["burn must be an object holding a theme block"];
  }
  const problems = Object.keys(burn)
    .filter((k) => k !== "theme")
    .map((k) => `burn.${k} is not a known key (the only key is theme)`);
  const theme = (burn as Record<string, unknown>).theme;
  if (theme === undefined) return problems;
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) {
    return [...problems, "burn.theme must be an object"];
  }
  const preset = (theme as Record<string, unknown>).preset;
  if (preset !== undefined && (typeof preset !== "string" || !THEME_PRESETS.includes(preset))) {
    const shown = typeof preset === "string" ? preset : JSON.stringify(preset);
    problems.push(`burn.theme.preset "${shown}" is not one of ${THEME_PRESETS.join(", ")}`);
  }
  return problems;
}

/** Field-level validity of `.docsxai.json` (the schema id is checked by `checkWorkspace`). */
export function checkConfigFields(config: Config): DoctorCheck[] {
  if (!config) return [];
  const problems: string[] = [];
  for (const key of ["app_url", "backend_url"]) {
    if (config[key] === undefined) continue;
    const p = httpUrlProblem(key, config[key]);
    if (p) problems.push(p);
  }
  if (config.ignore_https_errors !== undefined && typeof config.ignore_https_errors !== "boolean") {
    problems.push("ignore_https_errors must be true or false");
  }
  if (config.burn !== undefined) problems.push(...themeProblems(config.burn));
  const checks: DoctorCheck[] = [];
  if (problems.length > 0) {
    checks.push({
      name: "config",
      ok: false,
      detail: `${WORKSPACE_CONFIG_FILE}: ${problems.join("; ")}`,
      fix: `edit ${WORKSPACE_CONFIG_FILE} (keys and ranges: docs/burn-theming.md for burn.theme)`,
    });
  } else {
    checks.push({ name: "config", ok: true, detail: `${WORKSPACE_CONFIG_FILE} fields are valid` });
  }
  if (config.burn !== undefined && problems.length === 0) {
    checks.push({
      name: "theme",
      ok: true,
      info: true,
      detail:
        "burn.theme block present and well-formed; its values and contrast are checked by the viewer, not by doctor",
      fix: "run `docsxai burn <workspace-dir>` to see every theme problem and contrast warning",
    });
  }
  return checks;
}

/** Write access to the workspace root and the dirs `run`, `burn` and `render` write into. */
export async function checkWritable(workspaceDir: string): Promise<DoctorCheck> {
  const root = path.resolve(workspaceDir);
  const candidates = [
    root,
    ...["flows", "docs", ".auth", ".viewer"].map((d) => path.join(root, d)),
  ];
  const blocked: string[] = [];
  for (const dir of candidates) {
    if (dir !== root && !existsSync(dir)) continue;
    try {
      await fs.access(dir, fsConstants.W_OK);
    } catch {
      blocked.push(dir);
    }
  }
  if (blocked.length === 0) {
    return { name: "writable", ok: true, detail: `${root} and its output dirs are writable` };
  }
  return {
    name: "writable",
    ok: false,
    detail: `no write access to ${blocked.join(", ")}`,
    fix: `chmod u+w ${blocked.map(shellQuote).join(" ")}, or use another workspace dir`,
  };
}

function errorCodes(e: unknown): string[] {
  const codes: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    cur = (cur as { cause?: unknown }).cause;
  }
  return codes;
}

const OFFLINE_CODES = ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "EHOSTUNREACH"];
const TLS_CODE = /^(CERT_|DEPTH_ZERO|UNABLE_TO_|SELF_SIGNED|ERR_TLS_)/;
const LOOPBACK = /^(localhost|127\.|\[?::1\]?$)|\.localhost$/;

/** One HEAD against `app_url`. Any HTTP answer counts as reachable. */
export async function checkAppUrl(
  config: Config,
  fetchImpl: typeof globalThis.fetch,
  offline: boolean,
): Promise<DoctorCheck | null> {
  const raw = typeof config?.app_url === "string" ? config.app_url : undefined;
  if (!raw || httpUrlProblem("app_url", raw)) return null;
  const shown = redactUrl(raw);
  if (offline) {
    return {
      name: "app_url",
      ok: true,
      info: true,
      detail: `${shown} not probed (--offline)`,
      fix: "run docsxai doctor without --offline to test reachability",
    };
  }
  try {
    const res = await fetchImpl(raw, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(APP_URL_TIMEOUT_MS),
    });
    return { name: "app_url", ok: true, detail: `${shown} answered HTTP ${res.status}` };
  } catch (e) {
    const codes = errorCodes(e);
    const host = new URL(raw).hostname;
    if (codes.some((c) => OFFLINE_CODES.includes(c)) && !LOOPBACK.test(host)) {
      return {
        name: "app_url",
        ok: true,
        info: true,
        detail: `${shown} not probed, this machine looks offline (${codes[0]})`,
        fix: "reconnect and run docsxai doctor again before `docsxai run`",
      };
    }
    if (codes.some((c) => TLS_CODE.test(c))) {
      return config?.ignore_https_errors === true
        ? {
            name: "app_url",
            ok: true,
            detail: `${shown} presents a certificate this probe rejects (${codes[0]}); ignore_https_errors is set, so run accepts it`,
          }
        : {
            name: "app_url",
            ok: false,
            detail: `${shown} certificate rejected (${codes[0]})`,
            fix: 'set "ignore_https_errors": true in .docsxai.json (or re-run init with --ignore-https-errors)',
          };
    }
    const timedOut = (e as Error).name === "TimeoutError";
    return {
      name: "app_url",
      ok: false,
      detail: timedOut
        ? `${shown} did not answer within ${APP_URL_TIMEOUT_MS / 1000}s`
        : `${shown} unreachable (${codes[0] ?? redactUrlsIn((e as Error).message)})`,
      fix: "start the app, or fix app_url in .docsxai.json",
    };
  }
}

/** Backend login state: only meaningful when `backend_url` is set. */
export function checkLogin(
  workspaceDir: string,
  config: Config,
  env: NodeJS.ProcessEnv,
): DoctorCheck {
  const backendUrl = typeof config?.backend_url === "string" ? config.backend_url : undefined;
  if (!backendUrl) {
    return {
      name: "login",
      ok: true,
      info: true,
      detail: "no backend_url, so no backend login is needed",
    };
  }
  if (env.DOCSX_TOKEN) return { name: "login", ok: true, detail: "DOCSX_TOKEN is set" };
  if (existsSync(path.join(path.resolve(workspaceDir), ".auth", "backend-token.json"))) {
    return { name: "login", ok: true, detail: "OAuth tokens at .auth/backend-token.json" };
  }
  return {
    name: "login",
    ok: false,
    detail: `not logged in to ${redactUrl(backendUrl)}; push and pull need a token`,
    fix: `docsxai login --backend-url ${shellQuote(redactUrl(backendUrl))} --oauth ${shellQuote(workspaceDir)}, or export DOCSX_TOKEN`,
  };
}
