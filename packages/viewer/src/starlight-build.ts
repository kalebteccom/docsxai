// Starlight site builder (build-toolchain integration) — `buildStarlightSite` runs `astro build`
// programmatically over a project emitted by `emitStarlightSite` (see `starlight-emit.ts`). It
// resolves the astro bin from this package's own install so tests never hit the network
// (`astroBin` overrides; ASTRO_TELEMETRY_DISABLED=1 always), and symlinks astro +
// @astrojs/starlight into the emitted site's node_modules when absent so the project builds
// against the workspace-pinned pair without a network install.

import { spawn } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { exists } from "./starlight-emit.js";

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

export interface BuildStarlightSiteOptions {
  /** An emitted Starlight project directory (`emitStarlightSite`'s `outDir`). */
  siteDir: string;
  /** Path to astro's bin script. Default: resolved from this package's own dependencies. */
  astroBin?: string;
  /** Extra environment variables for the build process. */
  env?: Record<string, string>;
  /** Kill the build after this long. Default: 10 minutes. */
  timeoutMs?: number;
}

export interface BuildStarlightSiteResult {
  ok: boolean;
  /** The built static site (`<siteDir>/dist`). */
  distDir: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

/**
 * Resolve an installed package's root directory through this package's own node_modules.
 * Falls back to walking up from the resolved main entry when the package doesn't export
 * its package.json (e.g. @astrojs/starlight).
 */
function resolvePackageDir(name: string): string {
  const require = createRequire(import.meta.url);
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // package.json not in the export map — resolve the entry and walk up to the package root.
  }
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === name) return dir;
    } catch {
      // not this directory — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot locate the package root of ${name}`);
    dir = parent;
  }
}

/** Resolve astro's bin script through this package's own node_modules. */
export function resolveAstroBin(): string {
  let pkgDir: string;
  try {
    pkgDir = resolvePackageDir("astro");
  } catch {
    throw new Error(
      "cannot resolve the astro package — pass `astroBin`, or run `npm install` inside the emitted site and build there",
    );
  }
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    bin?: Record<string, string> | string;
  };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["astro"];
  if (!bin) throw new Error("astro package has no bin entry");
  return path.join(pkgDir, bin);
}

/**
 * Run `astro build` in `siteDir`. When the site has no node_modules of its own, this package's
 * astro + @astrojs/starlight installs are symlinked in individually, so the emitted project
 * builds against the workspace-pinned pair without a network install. (Per-package links, not
 * a wholesale node_modules link: under pnpm each package's store directory only sees its own
 * dependencies — astro's parent node_modules does not contain starlight.)
 *
 * The zero-install shortcut requires `siteDir` to share a filesystem ancestor with this
 * package's install (the normal case: the site is emitted inside the repo that installed
 * docsxai). For a fully detached site directory, install inside the emitted site
 * (`npm install`) and build there — rollup mis-relativizes module ids whose only common
 * ancestor with the project root is `/`.
 */
export async function buildStarlightSite(
  opts: BuildStarlightSiteOptions,
): Promise<BuildStarlightSiteResult> {
  const astroBin = opts.astroBin ?? resolveAstroBin();
  const distDir = path.join(opts.siteDir, "dist");

  // astro + @astrojs/starlight must resolve from siteDir; link our own installs when absent.
  const siteModules = path.join(opts.siteDir, "node_modules");
  if (!(await exists(siteModules))) {
    try {
      const astroDir = resolvePackageDir("astro");
      const starlightDir = resolvePackageDir("@astrojs/starlight");
      await fs.mkdir(path.join(siteModules, "@astrojs"), { recursive: true });
      await fs.symlink(astroDir, path.join(siteModules, "astro"), "dir");
      await fs.symlink(starlightDir, path.join(siteModules, "@astrojs", "starlight"), "dir");
    } catch {
      // Neither package resolvable from here (e.g. a caller-supplied astroBin) — let the
      // build run against whatever the site directory provides and fail with astro's message.
    }
  }

  const started = performance.now();
  const child = spawn(process.execPath, [astroBin, "build"], {
    cwd: opts.siteDir,
    env: { ...process.env, ...opts.env, ASTRO_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));

  const code = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 600_000);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c ?? 1);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(1);
    });
  });

  const ok = code === 0 && (await exists(path.join(distDir, "index.html")));
  return { ok, distDir, durationMs: performance.now() - started, stdout, stderr };
}
