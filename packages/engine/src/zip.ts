// Package a workspace's doc pack into a single archive for hand-off. Shells out to the system
// `zip` binary (universal on macOS/Linux/WSL); errors clearly if it's missing. Excludes operator-
// local state (`.auth/`, halt screenshots, the rendered `.viewer/` by default) so the archive is
// reviewer-ready without manual cleanup.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface ZipOptions {
  workspace: string;
  output: string;
  /** Include the rendered viewer (`.viewer/`) in the archive. Default false — viewers are derived from the doc pack and re-rendering is cheap. */
  includeViewer?: boolean;
}

export interface ZipResult {
  output: string;
  bytes: number;
}

export class ZipError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

const DEFAULT_INCLUDES = ["flows/", "docs/", ".site-docs.json", "auth/strategy.yaml", "README.md"];

// Zip's `-x` patterns are matched against the archive path with fnmatch-style globs.
// `*` matches a single path segment; explicit patterns per level are clearer than `**`.
const DEFAULT_EXCLUDES = [
  ".auth/*",
  ".auth/**",
  "docs/*/halts/*",
  "docs/*/halts/**",
  ".DS_Store",
  "*/.DS_Store",
  "*.tmp",
];

export async function zipDocPack(opts: ZipOptions): Promise<ZipResult> {
  const { workspace, output, includeViewer = false } = opts;

  // 1. Workspace must exist.
  try {
    await fs.access(workspace);
  } catch {
    throw new ZipError(`workspace doesn't exist: ${workspace}`);
  }

  // 2. Output path: ensure parent exists, remove any prior file so `zip` doesn't append.
  const outAbs = path.resolve(output);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.rm(outAbs, { force: true });

  // 3. Filter to includes that actually exist in this workspace (zip warns on missing).
  const includesAll = includeViewer ? [...DEFAULT_INCLUDES, ".viewer/"] : DEFAULT_INCLUDES;
  const existing: string[] = [];
  for (const inc of includesAll) {
    try {
      await fs.access(path.join(workspace, inc));
      existing.push(inc);
    } catch {
      /* skip absent */
    }
  }
  if (existing.length === 0) {
    throw new ZipError(`workspace ${workspace} has nothing to zip (no flows/ or docs/ found)`);
  }

  // 4. Run zip from the workspace dir so paths inside the archive are workspace-relative.
  const excludes = [...DEFAULT_EXCLUDES];
  if (!includeViewer) excludes.push(".viewer/*", ".viewer/**");

  const args = ["-r", "-X", outAbs, ...existing, "-x", ...excludes];
  await runZip(args, workspace);

  const stat = await fs.stat(outAbs);
  return { output: outAbs, bytes: stat.size };
}

function runZip(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("zip", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) => {
      const msg =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? `'zip' binary not found on PATH. Install it (\`brew install zip\` on macOS; usually preinstalled on Linux/WSL).`
          : `zip command failed: ${e.message}`;
      reject(new ZipError(msg, e));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new ZipError(`zip exited with code ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
}
