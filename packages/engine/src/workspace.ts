// Workspace scaffolding & config.
//
// A *workspace* is the directory docsxai reads/writes for a project: `flows/`, `docs/`, `auth/`, plus
// (gitignored) `.auth/` and `.viewer/`, plus a small `.docsxai.json` config so `run`/`render`/`capture-auth`
// don't need `--base-url` / `--ignore-https-errors` on every call. **It must live outside the app repo**, docsxai
// operates *on* a running app from outside; it never writes into the app's source tree.
//
// `docsxai init <dir> --app-url <url>` scaffolds one; `--persist tmp` puts it in a throwaway temp dir.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { SAMPLE_FLOW, SAMPLE_FLOW_PATH, workspaceReadme } from "./workspace-templates.js";

export const WORKSPACE_CONFIG_FILE = ".docsxai.json";

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
      if (parent === probe) return p; // not even the filesystem root resolves, give up lexically
      suffix = suffix ? path.join(path.basename(probe), suffix) : path.basename(probe);
      probe = parent;
    }
  }
}

/**
 * Like {@link resolveWorkspacePath}, but additionally defends against symlink escape: the deepest
 * existing ancestor of the resolved path is realpath'd and containment re-verified against the
 * realpath'd workspace root. Use before writing to a path whose segments are user-influenced
 * (flow names, step ids, role names), a symlink inside the workspace pointing outside must throw.
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

/**
 * The bytes of a workspace file, or `null` when it is missing or reaches outside the workspace
 * through a symlink. For reads whose content leaves the machine (a push, an export): a linked
 * file must not be read.
 */
export async function readFileInside(
  workspaceDir: string,
  ...segments: string[]
): Promise<Buffer | null> {
  let abs: string;
  try {
    abs = await resolveWorkspacePathReal(workspaceDir, ...segments);
  } catch (e) {
    if (e instanceof WorkspacePathEscapeError) return null;
    throw e;
  }
  return fs.readFile(abs).catch(() => null);
}

/**
 * The names of the workspace's `flows/<name>.flow.yaml` files, sorted. A flow file that is a
 * symlink to somewhere outside the workspace is left out.
 */
export async function listFlowNamesInside(workspaceDir: string): Promise<string[]> {
  const entries = await fs
    .readdir(resolveWorkspacePath(workspaceDir, "flows"))
    .catch(() => [] as string[]);
  const names: string[] = [];
  for (const e of entries) {
    if (!e.endsWith(".flow.yaml")) continue;
    const abs = await resolveWorkspacePathReal(workspaceDir, "flows", e).catch((err: unknown) => {
      if (err instanceof WorkspacePathEscapeError) return null;
      throw err;
    });
    if (abs !== null) names.push(e.slice(0, -".flow.yaml".length));
  }
  return names.sort();
}

/**
 * The `burn.theme` block: the look of burned captions and of the viewer's overlay. Every key is
 * optional; no block means the original look. `@docsxai/viewer` checks the values and layers them
 * (default look, then `preset`, then the tokens file named by `from`, then the keys written here).
 * Keys, ranges and the token mapping: docs/burn-theming.md.
 */
export interface BurnThemeConfig {
  /** `clean`, `soft`, `high-contrast` or `readable`. */
  preset?: string;
  /** Tokens file (W3C design tokens or a flat map), relative to the workspace. */
  from?: string;
  /** Theme key to token path, for keys that must be found in the tokens file. */
  tokens?: Record<string, string>;
  accent?: string;
  ink?: string;
  callout_background?: string;
  callout_border_color?: string;
  callout_border_width?: number;
  radius?: number;
  /** A CSS box-shadow, or `none`. */
  shadow?: string;
  /** `circle`, `rounded` or `square`. */
  badge_shape?: string;
  badge_fill?: string;
  font_size?: number;
  line_height?: number;
  padding_x?: number;
  padding_y?: number;
  /** TTF or OTF file inside the workspace; the bundled Inter when unset. */
  font?: string;
  /**
   * Up to 8 TTF or OTF files inside the workspace, tried in order for characters `font` lacks,
   * before the bundled Noto Sans Arabic, Hebrew, Thai and Devanagari. Burned images only.
   */
  font_fallback?: string[];
  /** 400 or 600; the font file must have that weight (the bundled Inter is 400 only). */
  font_weight?: number;
  /** `auto`, `line`, `chevron` or `arrow`: how a callout joins its target. */
  connector_style?: string;
  /** `full`, `badge` or `auto`: caption, or numbered badge only. */
  caption_style?: string;
  /** Arrow length in px, 4 to 24. */
  arrow_size?: number;
  /** Widest callout as a share of the screenshot's width, 0.2 to 1. */
  max_width_ratio?: number;
  /** Multiplier of every caption dimension, 0.5 to 4, or `"auto"` (screenshot width over `display_width`, 1 to 4). */
  scale?: number | "auto";
  /**
   * CSS px the screenshot is shown at on the docs page, 240 to 2400. Read by `scale: "auto"`.
   * The object form picks `narrow` for screenshots narrower than `narrow_below` px (default 900)
   * and `default` (720 when absent) for the rest.
   */
  display_width?: number | { default?: number; narrow: number; narrow_below?: number };
}

export interface WorkspaceConfig {
  schema: "docsxai/workspace@1";
  /** Base URL of the running app this workspace documents. Used as the default for `run`/`capture-auth`. */
  app_url?: string;
  /** Accept self-signed/invalid TLS for `app_url` (e.g. a local HTTPS dev cert). */
  ignore_https_errors?: boolean;
  /** Backend stub/service URL for `push`/`pull` (e.g. `http://localhost:4477`). Optional, workspaces operate fully locally without it. */
  backend_url?: string;
  /** How `run` records annotations. Absent keys keep today's output. */
  annotations?: {
    /**
     * Write per-annotation `obstacles` (boxes of nearby text and controls, screenshot pixels, the
     * target excluded) so the burner keeps callouts off page content. Default false.
     */
    obstacles?: boolean;
  };
  /** How `burn`, `pack` and `render` draw captions. Absent keys keep today's look. */
  burn?: {
    theme?: BurnThemeConfig;
  };
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
  /** `manual-capture` (default) writes an `auth/strategy.yaml`; `none` skips it, for an app that needs no login. */
  auth?: "manual-capture" | "none";
  role?: string;
  /** Cache TTL for the captured session (`session`, or a duration like `1h`/`30m`). Default `1h`, a *fallback* used only when `authCookie` isn't set/found. */
  ttl?: string;
  /** Name of the app's auth/session cookie, when set, the cached session's expiry tracks this cookie, not `ttl`. */
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
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-workspace-"));
    ephemeral = true;
  } else {
    if (!opts.dir) throw new Error("init: a target directory is required (or use --persist tmp)");
    dir = path.resolve(opts.dir);
    if (!opts.force && (await isNonEmptyDir(dir))) {
      throw new Error(`init: ${dir} exists and is not empty; pick another dir or pass --force`);
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
    schema: "docsxai/workspace@1",
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
      schema: "docsxai/auth-strategy@1",
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

  await fs.writeFile(resolveWorkspacePath(dir, SAMPLE_FLOW_PATH), SAMPLE_FLOW, "utf8");
  created.push(SAMPLE_FLOW_PATH);

  await fs.writeFile(
    resolveWorkspacePath(dir, "README.md"),
    workspaceReadme(cfg, { auth, configFile: WORKSPACE_CONFIG_FILE }),
    "utf8",
  );
  created.push("README.md");

  return { dir, created, ephemeral };
}

/** Read `<dir>/.docsxai.json` if present. Returns `null` if absent or unreadable. */
export async function loadWorkspaceConfig(dir: string): Promise<WorkspaceConfig | null> {
  try {
    const text = await fs.readFile(resolveWorkspacePath(dir, WORKSPACE_CONFIG_FILE), "utf8");
    const parsed = JSON.parse(text) as WorkspaceConfig;
    if (parsed && parsed.schema === "docsxai/workspace@1") return parsed;
    return null;
  } catch {
    return null;
  }
}
