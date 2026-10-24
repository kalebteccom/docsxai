// What the Starlight emitter reads from a doc pack: which flows to include, each flow's steps with
// their images, captions and write-ups, and the style artifact. Split from starlight-emit.ts, which
// writes the site. Every flow name and step id becomes a path inside the emitted project, so the
// ones that are not plain path parts are left out here, with a warning, before any path is built.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnnotationRecord } from "./annotations.js";
import { discoverFlows, parseAnnotations } from "./render.js";
import { isSafeFlowName, isSafeStepId, showName } from "./safe-id.js";

export interface CaptionItem {
  n: number;
  copy: string;
}

export interface StepPage {
  id: string;
  /** Absolute path of the image to copy in (burned preferred), or null. */
  imageSrc: string | null;
  burned: boolean;
  items: CaptionItem[];
  md: string | null;
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function isFile(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
}

/**
 * The flows to include: those under `docsDir` (all, or the ones `wanted` names). A flow name that
 * is not a plain path part, or that `wanted` names and the pack lacks, is left out with a warning.
 */
export async function pickFlows(
  docsDir: string,
  wanted: string[] | undefined,
  warnings: string[],
): Promise<string[]> {
  const found = await discoverFlows(docsDir);
  const chosen = wanted?.length ? [...new Set(wanted)] : found;
  const picked: string[] = [];
  for (const flow of chosen) {
    if (!isSafeFlowName(flow) || flow.includes("/")) {
      warnings.push(
        `flow ${showName(flow)} skipped: a flow name cannot hold "/", "..", ":", "\\" or control characters, so rename it and emit again`,
      );
    } else if (!found.includes(flow)) {
      warnings.push(`flow ${showName(flow)} skipped: no ${flow}/annotations.json under ${docsDir}`);
    } else picked.push(flow);
  }
  return picked;
}

/** `docs/style.json`'s `visual` object; a file that is not a JSON object warns and reads as none. */
export async function readStyleVisual(
  docsDir: string,
  warnings: string[],
): Promise<Record<string, unknown> | undefined> {
  const text = await readText(path.join(docsDir, "style.json"));
  if (text === null) return undefined;
  try {
    const style = JSON.parse(text) as { visual?: unknown } | null;
    const visual = style?.visual;
    return typeof visual === "object" && visual !== null && !Array.isArray(visual)
      ? (visual as Record<string, unknown>)
      : undefined;
  } catch {
    warnings.push("docs/style.json is not valid JSON, so its visual settings were ignored");
    return undefined;
  }
}

/**
 * One flow's steps: annotation order first, then the screenshot file names when the flow has no
 * usable annotation (mirrors render.ts). A damaged annotations file warns and the page still gets
 * its screenshots.
 */
export async function readSteps(
  docsDir: string,
  flow: string,
  lang: string,
  warnings: string[],
): Promise<StepPage[]> {
  const flowSrc = path.join(docsDir, flow);
  const parsed = parseAnnotations(await readText(path.join(flowSrc, "annotations.json")), lang);
  for (const notice of parsed.notices) warnings.push(`flow ${showName(flow)}: ${notice}`);
  const annsByStep = new Map<string, AnnotationRecord[]>();
  for (const a of parsed.records) annsByStep.set(a.step, [...(annsByStep.get(a.step) ?? []), a]);
  let stepIds = [...annsByStep.keys()];
  if (stepIds.length === 0) {
    const shots = await fs.readdir(path.join(flowSrc, "screenshots")).catch(() => [] as string[]);
    stepIds = shots
      .filter((s) => s.endsWith(".png"))
      .map((s) => s.replace(/\.png$/, ""))
      .sort();
  }

  const steps: StepPage[] = [];
  for (const id of stepIds) {
    if (!isSafeStepId(id)) {
      warnings.push(
        `flow ${showName(flow)} step ${showName(id)} skipped: a step id cannot hold "/", "\\", "..", ":" or control characters, so rename it in the flow file and emit again`,
      );
      continue;
    }
    const burnedPath = path.join(flowSrc, "burned", `${id}.png`);
    const cleanPath = path.join(flowSrc, "screenshots", `${id}.png`);
    const burned = await isFile(burnedPath);
    const imageSrc = burned ? burnedPath : (await isFile(cleanPath)) ? cleanPath : null;
    if (imageSrc === null) warnings.push(`flow "${flow}" step "${id}": no screenshot`);
    const anns = annsByStep.get(id) ?? [];
    steps.push({
      id,
      imageSrc,
      burned,
      items: anns.map((a, i) => ({ n: a.index ?? i + 1, copy: a.copy })),
      md: await readText(path.join(flowSrc, `${id}.md`)),
    });
  }
  return steps;
}
