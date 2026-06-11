// Workspace scaffolding & config.
//
// A *workspace* is the directory site-docs reads/writes for a project: `flows/`, `docs/`, `auth/`, plus
// (gitignored) `.auth/` and `.viewer/`, plus a small `.site-docs.json` config so `run`/`render`/`capture-auth`
// don't need `--base-url` / `--ignore-https-errors` on every call. **It must live outside the app repo** — site-docs
// operates *on* a running app from outside; it never writes into the app's source tree.
//
// `site-docs init <dir> --app-url <url>` scaffolds one; `--persist tmp` puts it in a throwaway temp dir.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";

export const WORKSPACE_CONFIG_FILE = ".site-docs.json";

/** Thrown when a workspace-relative path resolves outside the workspace root. */
export class WorkspacePathEscapeError extends Error {
  constructor(
    readonly workspaceDir: string,
    readonly resolvedPath: string,
  ) {
    super(`path escapes workspace root ${workspaceDir}: ${resolvedPath}`);
    this.name = "WorkspacePathEscapeError";
  }
}

function assertContained(root: string, candidate: string): void {
  // Prefix check on a path-separator boundary: `/ws/docs-evil` must not pass for root `/ws/docs`.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new WorkspacePathEscapeError(root, candidate);
  }
}

/** Resolve path segments against a workspace root, guaranteeing containment. */
export function resolveWorkspacePath(workspaceDir: string, ...segments: string[]): string {
  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(root, ...segments);
  assertContained(root, resolved);
  return resolved;
}

/** Realpath of the deepest existing ancestor of `p`, with the non-existing suffix re-appended. */
async function realpathDeepestExisting(p: string): Promise<string> {
  let probe = p;
  let suffix = "";
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      return suffix ? path.join(real, suffix) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return p; // not even the filesystem root resolves — give up lexically
      suffix = suffix ? path.join(path.basename(probe), suffix) : path.basename(probe);
      probe = parent;
    }
  }
}

/**
 * Like {@link resolveWorkspacePath}, but additionally defends against symlink escape: the deepest
 * existing ancestor of the resolved path is realpath'd and containment re-verified against the
 * realpath'd workspace root. Use before writing to a path whose segments are user-influenced
 * (flow names, step ids, role names) — a symlink inside the workspace pointing outside must throw.
 */
export async function resolveWorkspacePathReal(
  workspaceDir: string,
  ...segments: string[]
): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceDir, ...segments);
  const rootReal = await realpathDeepestExisting(path.resolve(workspaceDir));
  const resolvedReal = await realpathDeepestExisting(resolved);
  assertContained(rootReal, resolvedReal);
  return resolved;
}

export interface WorkspaceConfig {
  schema: "site-docs/workspace@1";
  /** Base URL of the running app this workspace documents. Used as the default for `run`/`capture-auth`. */
  app_url?: string;
  /** Accept self-signed/invalid TLS for `app_url` (e.g. a local HTTPS dev cert). */
  ignore_https_errors?: boolean;
  /** Backend stub/service URL for `push`/`pull` (e.g. `http://localhost:4477`). Optional — workspaces operate fully locally without it. */
  backend_url?: string;
  /** Backend workspace ID, set by `push` after first round-trip. */
  backend_workspace_id?: string;
  /** Backend project ID, set by `push` after first round-trip. */
  backend_project_id?: string;
  created_at: string;
}

export interface InitWorkspaceOptions {
  /** Target directory. Ignored (a temp dir is used) when `persistTmp` is true; otherwise required. */
  dir?: string;
  /** Create the workspace in a throwaway temp dir instead of `dir`. */
  persistTmp?: boolean;
  appUrl?: string;
  /** `manual-capture` (default) writes an `auth/strategy.yaml`; `none` skips it. */
  auth?: "manual-capture" | "none";
  role?: string;
  /** Cache TTL for the captured session (`session`, or a duration like `1h`/`30m`). Default `1h` — a *fallback* used only when `authCookie` isn't set/found. */
  ttl?: string;
  /** Name of the app's auth/session cookie — when set, the cached session's expiry tracks this cookie, not `ttl`. */
  authCookie?: string;
  captureTrigger?: "console" | "button";
  ignoreHttpsErrors?: boolean;
  /** Allow scaffolding into a non-empty directory. */
  force?: boolean;
}

export interface InitWorkspaceResult {
  /** The (possibly temp) directory the workspace was created in. */
  dir: string;
  /** Paths created, relative to `dir`. */
  created: string[];
  /** True if `dir` is a throwaway temp dir (from `--persist tmp`). */
  ephemeral: boolean;
}

const README = (cfg: WorkspaceConfig) => `# site-docs workspace

This directory is a **site-docs workspace** — it holds the doc pack for one running app:

- \`flows/<flow>.flow.yaml\` — hand-editable flow-files (the source of truth for execution)
- \`docs/<flow>/{annotations.json, screenshots/, <step>.md}\`, \`docs/{style.yaml, locators.yaml}\` — the generated docs
- \`auth/strategy.yaml\` — how execution authenticates to the app
- \`.auth/<role>.json\` — captured session(s) (gitignored; never committed; never leaves this machine)
- \`.viewer/\` — the generated interactive viewer (gitignored)
- \`${WORKSPACE_CONFIG_FILE}\` — workspace config (\`app_url${cfg.app_url ? ` = ${cfg.app_url}` : ""}\`, \`ignore_https_errors = ${!!cfg.ignore_https_errors}\`)

**Do NOT place this directory inside the app's source repo.** site-docs documents the *running* app from outside;
keeping the workspace separate is what guarantees zero traces in the app repo.

Usage (from this directory):

\`\`\`
site-docs capture-auth .     # if auth is manual-capture: opens an instrumented browser; log in, then run window.__siteDocs.capture()
site-docs calibrate . --description path/to/flow.md   # (when the calibration stages land) produce/refresh flow-files
site-docs run .              # replay the flow-files headlessly; refresh annotations + screenshots
site-docs render . && open .viewer/index.html
\`\`\`
`;

async function isNonEmptyDir(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** Scaffold a workspace. Returns where it landed + what was created. */
export async function initWorkspace(opts: InitWorkspaceOptions): Promise<InitWorkspaceResult> {
  let dir: string;
  let ephemeral = false;
  if (opts.persistTmp) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-workspace-"));
    ephemeral = true;
  } else {
    if (!opts.dir) throw new Error("init: a target directory is required (or use --persist tmp)");
    dir = path.resolve(opts.dir);
    if (!opts.force && (await isNonEmptyDir(dir))) {
      throw new Error(`init: ${dir} exists and is not empty — pick another dir or pass --force`);
    }
  }

  const role = opts.role ?? "editor";
  const ttl = opts.ttl ?? "1h";
  const trigger = opts.captureTrigger ?? "console";
  const auth = opts.auth ?? "manual-capture";

  const created: string[] = [];
  for (const sub of ["flows", "docs", "auth", ".auth", ".viewer"]) {
    await fs.mkdir(resolveWorkspacePath(dir, sub), { recursive: true });
  }
  created.push("flows/", "docs/", "auth/", ".auth/", ".viewer/");

  await fs.writeFile(resolveWorkspacePath(dir, ".gitignore"), ".auth/\n.viewer/\n", "utf8");
  created.push(".gitignore");

  const cfg: WorkspaceConfig = {
    schema: "site-docs/workspace@1",
    ...(opts.appUrl ? { app_url: opts.appUrl } : {}),
    ...(opts.ignoreHttpsErrors ? { ignore_https_errors: true } : {}),
    created_at: new Date().toISOString(),
  };
  await fs.writeFile(
    resolveWorkspacePath(dir, WORKSPACE_CONFIG_FILE),
    JSON.stringify(cfg, null, 2) + "\n",
    "utf8",
  );
  created.push(WORKSPACE_CONFIG_FILE);

  if (auth === "manual-capture") {
    const descriptor = {
      schema: "site-docs/auth-strategy@1",
      default_role: role,
      roles: {
        [role]: {
          strategy: "manual-capture",
          options: { capture_trigger: trigger },
          cache: {
            enabled: true,
            store: "local",
            ttl,
            ...(opts.authCookie ? { auth_cookie: opts.authCookie } : {}),
          },
        },
      },
    };
    await fs.writeFile(
      resolveWorkspacePath(dir, "auth", "strategy.yaml"),
      stringifyYaml(descriptor, { lineWidth: 100 }),
      "utf8",
    );
    created.push("auth/strategy.yaml");
  }

  await fs.writeFile(resolveWorkspacePath(dir, "README.md"), README(cfg), "utf8");
  created.push("README.md");

  return { dir, created, ephemeral };
}

/** Read `<dir>/.site-docs.json` if present. Returns `null` if absent or unreadable. */
export async function loadWorkspaceConfig(dir: string): Promise<WorkspaceConfig | null> {
  try {
    const text = await fs.readFile(resolveWorkspacePath(dir, WORKSPACE_CONFIG_FILE), "utf8");
    const parsed = JSON.parse(text) as WorkspaceConfig;
    if (parsed && parsed.schema === "site-docs/workspace@1") return parsed;
    return null;
  } catch {
    return null;
  }
}
