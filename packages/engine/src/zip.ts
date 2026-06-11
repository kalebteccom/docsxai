// Package a workspace's doc pack into a single archive for hand-off. Zips in-process (fflate) —
// no system `zip` binary required. Excludes operator-local state (`.auth/`, halt screenshots, the
// rendered `.viewer/` by default) so the archive is reviewer-ready without manual cleanup.
//
// Archives are deterministic: entries are sorted, every entry carries a fixed mtime (the zip
// format's 1980-01-01 epoch, built from local wall-clock fields so the stored bytes don't vary
// with the machine's timezone), and the compression level is pinned. Same tree → same bytes.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { zipSync, type Zippable } from "fflate";
import {
  resolveWorkspacePath,
  resolveWorkspacePathReal,
  WorkspacePathEscapeError,
} from "./workspace.js";

export interface ZipOptions {
  workspace: string;
  output: string;
  /** Include the rendered viewer (`.viewer/`) in the archive. Default false — viewers are derived from the doc pack and re-rendering is cheap. */
  includeViewer?: boolean;
}

export interface ZipResult {
  output: string;
  bytes: number;
  /** Workspace-relative archive entries, in the (sorted) order they appear in the zip. */
  entries: string[];
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

const FIXED_MTIME = new Date(1980, 0, 1);
const FIXED_LEVEL = 6;

function isExcluded(relPath: string, includeViewer: boolean): boolean {
  const segments = relPath.split("/");
  if (segments.includes(".auth") || segments.includes("halts")) return true;
  if (!includeViewer && segments[0] === ".viewer") return true;
  const base = segments[segments.length - 1]!;
  return base === ".DS_Store" || base.endsWith(".tmp");
}

async function collectFiles(
  workspace: string,
  relDir: string,
  includeViewer: boolean,
  out: string[],
): Promise<void> {
  const entries = await fs.readdir(resolveWorkspacePath(workspace, relDir), {
    withFileTypes: true,
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (isExcluded(rel, includeViewer)) continue;
    if (entry.isDirectory()) {
      await collectFiles(workspace, rel, includeViewer, out);
    } else if (entry.isFile()) {
      out.push(rel);
    } else if (entry.isSymbolicLink()) {
      // The archive is a hand-off artifact: follow a symlink only if its target stays inside the
      // workspace — a link escaping the root must not exfiltrate whatever it points at.
      let stat;
      try {
        await resolveWorkspacePathReal(workspace, rel);
        stat = await fs.stat(resolveWorkspacePath(workspace, rel));
      } catch (e) {
        if (e instanceof WorkspacePathEscapeError) continue;
        continue; // broken symlink — nothing to archive
      }
      if (stat.isDirectory()) await collectFiles(workspace, rel, includeViewer, out);
      else if (stat.isFile()) out.push(rel);
    }
  }
}

export async function zipDocPack(opts: ZipOptions): Promise<ZipResult> {
  const { workspace, output, includeViewer = false } = opts;

  try {
    await fs.access(workspace);
  } catch {
    throw new ZipError(`workspace doesn't exist: ${workspace}`);
  }

  const outAbs = path.resolve(output);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  const includesAll = includeViewer ? [...DEFAULT_INCLUDES, ".viewer/"] : DEFAULT_INCLUDES;
  const files: string[] = [];
  let anyIncludePresent = false;
  for (const inc of includesAll) {
    const rel = inc.endsWith("/") ? inc.slice(0, -1) : inc;
    let stat;
    try {
      stat = await fs.stat(resolveWorkspacePath(workspace, rel));
    } catch {
      continue; // skip absent
    }
    anyIncludePresent = true;
    if (stat.isDirectory()) await collectFiles(workspace, rel, includeViewer, files);
    else files.push(rel);
  }
  if (!anyIncludePresent) {
    throw new ZipError(`workspace ${workspace} has nothing to zip (no flows/ or docs/ found)`);
  }

  files.sort();
  const zippable: Zippable = {};
  for (const rel of files) {
    const data = await fs.readFile(resolveWorkspacePath(workspace, rel));
    zippable[rel] = [new Uint8Array(data), { level: FIXED_LEVEL, mtime: FIXED_MTIME }];
  }

  let bytes: Uint8Array;
  try {
    bytes = zipSync(zippable, { level: FIXED_LEVEL, mtime: FIXED_MTIME });
  } catch (e) {
    throw new ZipError(`failed to build archive: ${(e as Error).message}`, e);
  }
  await fs.writeFile(outAbs, bytes);
  return { output: outAbs, bytes: bytes.length, entries: files };
}
