// Serialise a workspace's on-disk doc pack into the backend's per-artifact payload shapes,
// and (for `pull`) deserialise the payloads back into workspace files.
//
// The backend treats payloads as opaque; the schemas here are the engine's own contract.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type {
  AnnotationsPayload,
  FlowsPayload,
  LocatorsPayload,
  ScreenshotsPayload,
  StylePayload,
} from "./backend-client.js";

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
  const dir = path.join(workspace, "flows");
  const entries = await fs.readdir(dir).catch(() => null);
  if (!entries) return null;
  const yamls = entries.filter((e) => e.endsWith(".flow.yaml"));
  if (yamls.length === 0) return null;
  const files: Record<string, string> = {};
  for (const f of yamls) {
    files[f] = await fs.readFile(path.join(dir, f), "utf8");
  }
  return { schema: "site-docs/flows@1", files };
}

async function readAnnotations(workspace: string): Promise<AnnotationsPayload | null> {
  const docsDir = path.join(workspace, "docs");
  const flows = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const files: Record<string, unknown> = {};
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    const annPath = path.join(docsDir, ent.name, "annotations.json");
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
  const docsDir = path.join(workspace, "docs");
  const flows = await fs.readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const files: Record<string, string> = {};
  for (const ent of flows) {
    if (!ent.isDirectory()) continue;
    const screenDir = path.join(docsDir, ent.name, "screenshots");
    const shots = await fs.readdir(screenDir).catch(() => null);
    if (!shots) continue;
    for (const f of shots) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
      const buf = await fs.readFile(path.join(screenDir, f));
      files[`${ent.name}/screenshots/${f}`] = buf.toString("base64");
    }
  }
  if (Object.keys(files).length === 0) return null;
  return { schema: "site-docs/screenshots@1", files };
}

async function readStyle(workspace: string): Promise<StylePayload | null> {
  const yamlPath = path.join(workspace, "docs", "style.yaml");
  const jsonPath = path.join(workspace, "docs", "style.json");
  const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
  const jsonText = await fs.readFile(jsonPath, "utf8").catch(() => null);
  if (yaml === null && jsonText === null) return null;
  const json = jsonText ? JSON.parse(jsonText) : null;
  return { schema: "site-docs/style-bundle@1", yaml, json };
}

async function readLocators(workspace: string): Promise<LocatorsPayload | null> {
  const yamlPath = path.join(workspace, "docs", "locators.yaml");
  const yaml = await fs.readFile(yamlPath, "utf8").catch(() => null);
  if (yaml === null) return null;
  return { schema: "site-docs/locators@1", yaml };
}

// --- write back (pull) ------------------------------------------------------

export async function writeDocPack(workspace: string, payloads: Partial<DocPackPayloads>): Promise<{ filesWritten: number }> {
  let n = 0;
  if (payloads.flows) {
    const dir = path.join(workspace, "flows");
    await fs.mkdir(dir, { recursive: true });
    for (const [f, text] of Object.entries(payloads.flows.files)) {
      await fs.writeFile(path.join(dir, f), text, "utf8");
      n++;
    }
  }
  if (payloads.annotations) {
    for (const [rel, json] of Object.entries(payloads.annotations.files)) {
      const abs = path.join(workspace, "docs", rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, JSON.stringify(json, null, 2) + "\n", "utf8");
      n++;
    }
  }
  if (payloads.screenshots) {
    for (const [rel, b64] of Object.entries(payloads.screenshots.files)) {
      const abs = path.join(workspace, "docs", rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, Buffer.from(b64, "base64"));
      n++;
    }
  }
  if (payloads.style) {
    if (payloads.style.yaml !== null) {
      const p = path.join(workspace, "docs", "style.yaml");
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, payloads.style.yaml, "utf8");
      n++;
    }
    if (payloads.style.json !== null) {
      const p = path.join(workspace, "docs", "style.json");
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(payloads.style.json, null, 2) + "\n", "utf8");
      n++;
    }
  }
  if (payloads.locators?.yaml) {
    const p = path.join(workspace, "docs", "locators.yaml");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, payloads.locators.yaml, "utf8");
    n++;
  }
  return { filesWritten: n };
}
