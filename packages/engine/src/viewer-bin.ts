// Resolution of the `docsxai-viewer` bin for `site-docs render`. The viewer is its own package and
// the engine doesn't depend on it at build time, so the bin is located at run time, in order:
//
//   1. `SITE_DOCS_VIEWER_BIN` — explicit operator override; a path to the viewer's bin script
//      (run with the current Node when it's a `.js`/`.mjs`/`.cjs` file) or to an executable.
//   2. The `@kalebtec/docsxai-viewer` package installed next to the engine: its `package.json` is
//      looked up along the engine's node_modules ancestor chain and the `bin` entry is run with
//      the current Node — covers installs where the package is present but no PATH shim is.
//      (A direct manifest read, not `require.resolve("…/package.json")` — the viewer's `exports`
//      map doesn't export its package.json. The chain is walked explicitly rather than via
//      `require.resolve.paths()`, which test runners extend with extra lookup dirs.)
//   3. `docsxai-viewer` on PATH (the npm bin shim) — the legacy behavior, kept as the fallback.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const VIEWER_BIN_ENV = "SITE_DOCS_VIEWER_BIN";
export const VIEWER_PACKAGE = "@kalebtec/docsxai-viewer";
export const VIEWER_BIN_NAME = "docsxai-viewer";

export interface ViewerBinResolution {
  /** Command to spawn. */
  command: string;
  /** Args to pass before the caller's own (the bin script path when `command` is the Node binary). */
  prefixArgs: string[];
  source: "env" | "package" | "path";
  /** Human-readable description of every resolution step tried, ending with the one that resolved. */
  attempts: string[];
}

export interface ResolveViewerBinOptions {
  env?: Record<string, string | undefined>;
  /** Directories whose `node_modules` to search for the viewer package. Defaults to the engine's own resolution chain. */
  resolveFrom?: string[];
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function findViewerManifest(searchDirs: string[]): Promise<string | undefined> {
  for (const dir of searchDirs) {
    const manifest = path.join(dir, VIEWER_PACKAGE, "package.json");
    if (await isFile(manifest)) return manifest;
  }
  return undefined;
}

/** The `node_modules` dirs Node itself would search from this module's location. */
function defaultSearchDirs(): string[] {
  const dirs: string[] = [];
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (path.basename(dir) !== "node_modules") dirs.push(path.join(dir, "node_modules"));
    const parent = path.dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

export async function resolveViewerBin(
  opts: ResolveViewerBinOptions = {},
): Promise<ViewerBinResolution> {
  const env = opts.env ?? process.env;
  const attempts: string[] = [];

  const envBin = env[VIEWER_BIN_ENV];
  if (envBin) {
    if (await isFile(envBin)) {
      attempts.push(`$${VIEWER_BIN_ENV} → ${envBin}`);
      return /\.(c|m)?js$/.test(envBin)
        ? { command: process.execPath, prefixArgs: [envBin], source: "env", attempts }
        : { command: envBin, prefixArgs: [], source: "env", attempts };
    }
    attempts.push(`$${VIEWER_BIN_ENV} → ${envBin} (no such file)`);
  } else {
    attempts.push(`$${VIEWER_BIN_ENV} — not set`);
  }

  const searchDirs = opts.resolveFrom
    ? opts.resolveFrom.map((d) => path.join(d, "node_modules"))
    : defaultSearchDirs();
  const manifestPath = await findViewerManifest(searchDirs);
  if (manifestPath) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binRel =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[VIEWER_BIN_NAME];
    if (binRel) {
      const binAbs = path.resolve(path.dirname(manifestPath), binRel);
      if (await isFile(binAbs)) {
        attempts.push(`${VIEWER_PACKAGE} (installed package) → ${binAbs}`);
        return { command: process.execPath, prefixArgs: [binAbs], source: "package", attempts };
      }
      attempts.push(
        `${VIEWER_PACKAGE} (installed package) → ${binAbs} (bin file missing — is the package built?)`,
      );
    } else {
      attempts.push(
        `${VIEWER_PACKAGE} (installed package) → ${manifestPath} (no "${VIEWER_BIN_NAME}" bin entry)`,
      );
    }
  } else {
    attempts.push(`${VIEWER_PACKAGE} (installed package) — not found next to the engine`);
  }

  attempts.push(`\`${VIEWER_BIN_NAME}\` on PATH`);
  return { command: VIEWER_BIN_NAME, prefixArgs: [], source: "path", attempts };
}

/** Failure message for when the resolved command could not be launched (spawn ENOENT). */
export function formatViewerBinFailure(resolution: ViewerBinResolution): string {
  const lines = resolution.attempts.map(
    (a, i, all) => `  ${i + 1}. ${a}${i === all.length - 1 ? " — not found" : ""}`,
  );
  return [
    `\`${VIEWER_BIN_NAME}\` could not be launched. Tried, in order:`,
    ...lines,
    `Install ${VIEWER_PACKAGE} next to the engine (or globally), or point ${VIEWER_BIN_ENV} at its bin script.`,
  ].join("\n");
}
