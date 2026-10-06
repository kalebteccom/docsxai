// Serialise a workspace's on-disk doc pack into the backend's per-artifact payload shapes,
// and (for `pull`) deserialise the payloads back into workspace files.
//
// The backend treats payloads as opaque; the schemas here are the engine's own contract.
// Screenshot bytes travel as content-addressed blobs — the screenshots artifact carries only a
// sha256 manifest; `uploadScreenshotBlobs` / `fetchScreenshotBlobs` move the bytes.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  AnnotationsPayload,
  BlobRef,
  FlowsPayload,
  LocatorsPayload,
  ScreenshotsPayload,
  StylePayload,
} from "./backend-client.js";
import { FlowName } from "./doc-pack.js";
import { findCaseCollision } from "./flow-name-rules.js";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

export interface DocPackPayloads {
  flows: FlowsPayload | null;
  annotations: AnnotationsPayload | null;
  screenshots: ScreenshotsPayload | null;
  style: StylePayload | null;
  locators: LocatorsPayload | null;
}

/** Read the workspace's doc pack from disk into the per-artifact payload shape the backend accepts. */
export async function readDocPack(workspace: string): Promise<DocPackPayloads> {
  return {
    flows: await readFlows(workspace),
    annotations: await readAnnotations(workspace),
    screenshots: await readScreenshots(workspace),
    style: await readStyle(workspace),
    locators: await readLocators(workspace),
  };
}

async function readFlows(workspace: string): Promise<FlowsPayload | null> {
  const dir = resolveWorkspacePath(workspace, "flows");
  const entries = await fs.readdir(dir).catch(() => null);
  if (!entries) return null;
  const yamls = entries.filter((e) => e.endsWith(".flow.yaml"));
  if (yamls.length === 0) return null;
  const files: Record<string, string> = {};
  for (const f of yamls) {
    files[f] = await fs.readFile(resolveWorkspacePath(workspace, "flows", f), "utf8");
  }
  return { schema: "docsxai/flows@1", files };
}

/**
 * Directories under `docs/` that can hold a flow's outputs, relative to it: `<flow>`, then each
 * `<flow>/<variant>` (a flow with a `matrix` writes there). A directory without outputs is harmless.
 */
async function outputDirs(workspace: string): Promise<string[]> {
  const docsDir = resolveWorkspacePath(workspace, "docs");
  const flows = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    dirs.push(ent.name);
    const subs = await fs
      .readdir(resolveWorkspacePath(workspace, "docs", ent.name), { withFileTypes: true })
      .catch(() => []);
    for (const sub of subs) if (sub.isDirectory()) dirs.push(`${ent.name}/${sub.name}`);
  }
  return dirs;
}

async function readAnnotations(workspace: string): Promise<AnnotationsPayload | null> {
  const files: Record<string, unknown> = {};
  for (const dir of await outputDirs(workspace)) {
    const annPath = resolveWorkspacePath(workspace, "docs", dir, "annotations.json");
    const text = await fs.readFile(annPath, "utf8").catch(() => null);
    if (text === null) continue;
    try {
      files[`${dir}/annotations.json`] = JSON.parse(text);
    } catch {
      // skip unparseable files (push surfaces them in lint output, not here)
    }
  }
  if (Object.keys(files).length === 0) return null;
  return { schema: "docsxai/annotations-bundle@1", files };
}

async function readScreenshots(workspace: string): Promise<ScreenshotsPayload | null> {
  const files: Record<string, BlobRef> = {};
  for (const dir of await outputDirs(workspace)) {
    const screenDir = resolveWorkspacePath(workspace, "docs", dir, "screenshots");
    const shots = await fs.readdir(screenDir).catch(() => null);
    if (!shots) continue;
    for (const f of shots) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
      const buf = await fs.readFile(resolveWorkspacePath(workspace, "docs", dir, "screenshots", f));
      files[`${dir}/screenshots/${f}`] = {
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.byteLength,
      };
    }
  }
  if (Object.keys(files).length === 0) return null;
  return { schema: "docsxai/screenshots@2", files };
}

// --- screenshot blob transport ------------------------------------------------

export interface BlobUploader {
  hasBlob(sha256: string): Promise<boolean>;
  putBlob(data: Uint8Array): Promise<BlobRef>;
}

export interface BlobFetcher {
  getBlob(sha256: string): Promise<Uint8Array>;
}

/** Upload the bytes behind a screenshots manifest, HEAD-probing first so shared blobs are skipped. */
export async function uploadScreenshotBlobs(
  workspace: string,
  manifest: ScreenshotsPayload,
  blobs: BlobUploader,
): Promise<{ uploaded: number; skipped: number }> {
  let uploaded = 0;
  let skipped = 0;
  for (const [rel, ref] of Object.entries(manifest.files)) {
    if (await blobs.hasBlob(ref.sha256)) {
      skipped++;
      continue;
    }
    const data = await fs.readFile(resolveWorkspacePath(workspace, "docs", rel));
    const stored = await blobs.putBlob(data);
    if (stored.sha256 !== ref.sha256) {
      throw new Error(
        `screenshot ${rel} changed on disk between manifest and upload (sha256 ${ref.sha256} → ${stored.sha256})`,
      );
    }
    uploaded++;
  }
  return { uploaded, skipped };
}

/** Fetch the bytes behind a screenshots manifest, verifying each blob against its sha256. */
export async function fetchScreenshotBlobs(
  manifest: ScreenshotsPayload,
  blobs: BlobFetcher,
): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const [rel, ref] of Object.entries(manifest.files)) {
    const data = await blobs.getBlob(ref.sha256);
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (sha256 !== ref.sha256) {
      throw new Error(
        `blob for ${rel} failed integrity check (expected ${ref.sha256}, got ${sha256})`,
      );
    }
    out[rel] = data;
  }
  return out;
}

async function readStyle(workspace: string): Promise<StylePayload | null> {
  const yamlPath = resolveWorkspacePath(workspace, "docs", "style.yaml");
  const jsonPath = resolveWorkspacePath(workspace, "docs", "style.json");
  const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
  const jsonText = await fs.readFile(jsonPath, "utf8").catch(() => null);
  if (yaml === null && jsonText === null) return null;
  const json = jsonText ? JSON.parse(jsonText) : null;
  return { schema: "docsxai/style-bundle@1", yaml, json };
}

async function readLocators(workspace: string): Promise<LocatorsPayload | null> {
  const yamlPath = resolveWorkspacePath(workspace, "docs", "locators.yaml");
  const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
  if (yaml === null) return null;
  return { schema: "docsxai/locators@1", yaml };
}

// --- write back (pull) ------------------------------------------------------

/** A pulled payload named a file the workspace would not have produced; nothing was written. */
export class UnsafePackNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePackNameError";
  }
}

const FLOW_FILE_SUFFIX = ".flow.yaml";
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCREENSHOT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;

const isFlowName = (name: string): boolean => FlowName.safeParse(name).success;
const isSafeSegment = (seg: string): boolean =>
  seg.length <= 128 && SAFE_SEGMENT.test(seg) && !seg.includes("..") && !seg.endsWith(".");

/** `<flow>[/<variant>]`, every segment safe, the flow segment a valid flow name. */
function isOutputDir(segments: string[]): boolean {
  const [flow, ...variants] = segments;
  return (
    flow !== undefined && isFlowName(flow) && variants.length <= 1 && variants.every(isSafeSegment)
  );
}

/** `flows/<name>.flow.yaml`: the file name is `<valid flow name>.flow.yaml`. */
function isFlowFileName(file: string): boolean {
  return file.endsWith(FLOW_FILE_SUFFIX) && isFlowName(file.slice(0, -FLOW_FILE_SUFFIX.length));
}

/** `docs/<flow>[/<variant>]/annotations.json`, relative to `docs/`. */
function isAnnotationsPath(rel: string): boolean {
  const segments = rel.split("/");
  return segments.pop() === "annotations.json" && isOutputDir(segments);
}

/** `docs/<flow>[/<variant>]/screenshots/<file>`, relative to `docs/`. */
function isScreenshotPath(rel: string): boolean {
  const segments = rel.split("/");
  const file = segments.pop() ?? "";
  return SCREENSHOT_FILE.test(file) && segments.pop() === "screenshots" && isOutputDir(segments);
}

function describeName(name: string): string {
  const shown = name.length > 80 ? `${name.slice(0, 80)}...` : name;
  return JSON.stringify(shown);
}

/**
 * Throws {@link UnsafePackNameError} on the first file name in `payloads` that is not one a
 * workspace produces: a flow file that is not `<flow name>.flow.yaml`, an annotations file that is
 * not `<flow>[/<variant>]/annotations.json`, a screenshot that is not under a `screenshots/`
 * directory of such a path, or two flow files that differ only by case. The backend is not trusted
 * with names, and a name like `../.docsxai.json` would otherwise land on workspace config.
 */
export function assertSafePackNames(payloads: Partial<DocPackPayloads>): void {
  const checks: Array<[string, string[], (name: string) => boolean]> = [
    ["flows", Object.keys(payloads.flows?.files ?? {}), isFlowFileName],
    ["annotations", Object.keys(payloads.annotations?.files ?? {}), isAnnotationsPath],
    ["screenshots", Object.keys(payloads.screenshots?.files ?? {}), isScreenshotPath],
  ];
  for (const [artifact, names, ok] of checks) {
    const bad = names.find((n) => !ok(n));
    if (bad !== undefined) {
      throw new UnsafePackNameError(
        `refusing the pulled doc pack, nothing written: ${artifact} file name ${describeName(bad)} is not a valid ${artifact} path`,
      );
    }
  }
  const clash = findCaseCollision(Object.keys(payloads.flows?.files ?? {}));
  if (clash) {
    throw new UnsafePackNameError(
      `refusing the pulled doc pack, nothing written: flows ${describeName(clash[0])} and ${describeName(clash[1])} differ only by case`,
    );
  }
}

export async function writeDocPack(
  workspace: string,
  payloads: Partial<DocPackPayloads>,
  extras: {
    /** Screenshot bytes keyed by manifest path (from {@link fetchScreenshotBlobs}). */
    screenshotBytes?: Record<string, Uint8Array>;
  } = {},
): Promise<{ filesWritten: number }> {
  let n = 0;
  // Pulled payload file names come from the backend: check every one before the first write, then
  // resolve with the symlink-aware variant.
  assertSafePackNames(payloads);
  if (payloads.flows) {
    await fs.mkdir(resolveWorkspacePath(workspace, "flows"), { recursive: true });
    for (const [f, text] of Object.entries(payloads.flows.files)) {
      await fs.writeFile(await resolveWorkspacePathReal(workspace, "flows", f), text, "utf8");
      n++;
    }
  }
  if (payloads.annotations) {
    for (const [rel, json] of Object.entries(payloads.annotations.files)) {
      const abs = await resolveWorkspacePathReal(workspace, "docs", rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, JSON.stringify(json, null, 2) + "\n", "utf8");
      n++;
    }
  }
  if (payloads.screenshots && extras.screenshotBytes) {
    for (const rel of Object.keys(payloads.screenshots.files)) {
      const data = extras.screenshotBytes[rel];
      if (!data) continue;
      const abs = await resolveWorkspacePathReal(workspace, "docs", rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, data);
      n++;
    }
  }
  if (payloads.style) {
    if (payloads.style.yaml !== null) {
      const p = resolveWorkspacePath(workspace, "docs", "style.yaml");
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, payloads.style.yaml, "utf8");
      n++;
    }
    if (payloads.style.json !== null) {
      const p = resolveWorkspacePath(workspace, "docs", "style.json");
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(payloads.style.json, null, 2) + "\n", "utf8");
      n++;
    }
  }
  if (payloads.locators?.yaml) {
    const p = resolveWorkspacePath(workspace, "docs", "locators.yaml");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, payloads.locators.yaml, "utf8");
    n++;
  }
  return { filesWritten: n };
}
