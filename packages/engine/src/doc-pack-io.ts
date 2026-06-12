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
  return { schema: "site-docs/flows@1", files };
}

async function readAnnotations(workspace: string): Promise<AnnotationsPayload | null> {
  const docsDir = resolveWorkspacePath(workspace, "docs");
  const flows = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const files: Record<string, unknown> = {};
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    const annPath = resolveWorkspacePath(workspace, "docs", ent.name, "annotations.json");
    const text = await fs.readFile(annPath, "utf8").catch(() => null);
    if (text === null) continue;
    try {
      files[`${ent.name}/annotations.json`] = JSON.parse(text);
    } catch {
      // skip unparseable files (push surfaces them in lint output, not here)
    }
  }
  if (Object.keys(files).length === 0) return null;
  return { schema: "site-docs/annotations-bundle@1", files };
}

async function readScreenshots(workspace: string): Promise<ScreenshotsPayload | null> {
  const docsDir = resolveWorkspacePath(workspace, "docs");
  const flows = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const files: Record<string, BlobRef> = {};
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    const screenDir = resolveWorkspacePath(workspace, "docs", ent.name, "screenshots");
    const shots = await fs.readdir(screenDir).catch(() => null);
    if (!shots) continue;
    for (const f of shots) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
      const buf = await fs.readFile(
        resolveWorkspacePath(workspace, "docs", ent.name, "screenshots", f),
      );
      files[`${ent.name}/screenshots/${f}`] = {
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.byteLength,
      };
    }
  }
  if (Object.keys(files).length === 0) return null;
  return { schema: "site-docs/screenshots@2", files };
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
  return { schema: "site-docs/style-bundle@1", yaml, json };
}

async function readLocators(workspace: string): Promise<LocatorsPayload | null> {
  const yamlPath = resolveWorkspacePath(workspace, "docs", "locators.yaml");
  const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
  if (yaml === null) return null;
  return { schema: "site-docs/locators@1", yaml };
}

// --- write back (pull) ------------------------------------------------------

export async function writeDocPack(
  workspace: string,
  payloads: Partial<DocPackPayloads>,
  extras: {
    /** Screenshot bytes keyed by manifest path (from {@link fetchScreenshotBlobs}). */
    screenshotBytes?: Record<string, Uint8Array>;
  } = {},
): Promise<{ filesWritten: number }> {
  let n = 0;
  // Pulled payload file names come from the backend — treat as untrusted and resolve with the
  // symlink-aware variant before writing.
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
