// `docsxai drift`: compare a pack rebuilt in memory with the committed one. Equal hash8 is
// unchanged. Otherwise both PNGs are compared pixel by pixel, which also tells a real change from
// an optimiser difference (same pixels, other bytes: passes). The report has no timestamps and is
// sorted, so the same two packs print the same text.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { BoundingBox } from "./annotations.js";
import { hash8, type BuiltPack } from "./pack-build.js";
import { diffPngs, type Size } from "./pack-pixels.js";
import { PACK_MANIFEST_FILE, fileOfSrc, type ScreensPack } from "./pack-schema.js";
import { validatePack } from "./pack-validate.js";

export const DEFAULT_THRESHOLD_PCT = 0.5;

export type DriftStatus = "new" | "missing" | "resized" | "changed" | "broken";

export interface DriftEntry {
  /** `<flow>/<step>/<variant key>` */
  id: string;
  status: DriftStatus;
  /** Counts toward a non-zero exit. */
  failing: boolean;
  pct?: number;
  region?: BoundingBox;
  from?: Size;
  to?: Size;
  /** `broken`: what is wrong with the committed file. */
  detail?: string;
}

export interface DriftReport {
  /** Variants present in both packs. */
  compared: number;
  failing: number;
  thresholdPct: number;
  entries: DriftEntry[];
  /** The report as printed. */
  text: string;
}

function variantsOf(pack: ScreensPack): Map<string, string> {
  const map = new Map<string, string>();
  for (const [flow, f] of Object.entries(pack.flows)) {
    for (const [step, s] of Object.entries(f.steps)) {
      for (const [key, v] of Object.entries(s.variants)) map.set(`${flow}/${step}/${key}`, v.src);
    }
  }
  return map;
}

/** Reads and validates `<dir>/manifest.json`. */
export async function readCommittedPack(dir: string): Promise<ScreensPack> {
  const file = path.join(dir, PACK_MANIFEST_FILE);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing ? `no ${PACK_MANIFEST_FILE} in ${dir}` : `${file}: ${(e as Error).message}`,
    );
  }
  const { ok, errors } = validatePack(value);
  if (!ok) {
    const shape =
      (value as { schema?: unknown } | null)?.schema === "docsxai/screens-pack@2"
        ? ""
        : ` Only docsxai/screens-pack@2 can be compared; rebuild the committed pack with \`docsxai pack\`.`;
    throw new Error(
      `${file} is not a valid pack:${shape}\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  return value as ScreensPack;
}

function describe(e: DriftEntry): string {
  switch (e.status) {
    case "new":
    case "missing":
      return `${e.status.padEnd(8)} ${e.id}`;
    case "broken":
      return `broken   ${e.id}  ${e.detail}`;
    case "resized":
      return `resized  ${e.id}  ${e.from!.width}x${e.from!.height} -> ${e.to!.width}x${e.to!.height}`;
    default: {
      const r = e.region!;
      const where = `  region ${r.x},${r.y} ${r.width}x${r.height}`;
      return `changed  ${e.id}  ${e.pct}%${where}${e.failing ? "  OVER" : ""}`;
    }
  }
}

async function compareVariant(
  id: string,
  committedFile: string,
  fresh: Buffer,
  freshFile: string,
  against: string,
  thresholdPct: number,
): Promise<DriftEntry | null> {
  const stored = await fs.readFile(path.join(against, committedFile)).catch(() => null);
  if (stored === null) {
    return { id, status: "broken", failing: true, detail: `${committedFile} is not on disk` };
  }
  const committedHash = committedFile.split(".").at(-2);
  if (hash8(stored) !== committedHash) {
    return {
      id,
      status: "broken",
      failing: true,
      detail: `${committedFile} does not match its hash`,
    };
  }
  if (freshFile === committedFile) return null;
  const diff = diffPngs(stored, fresh);
  if (diff.kind === "resized") {
    return { id, status: "resized", failing: true, from: diff.from, to: diff.to };
  }
  if (diff.changed === 0) return null;
  return {
    id,
    status: "changed",
    failing: diff.pct > thresholdPct,
    pct: diff.pct,
    region: diff.region!,
  };
}

export interface ComputeDriftOptions {
  /** The pack rebuilt from the current capture. */
  fresh: BuiltPack;
  /** Directory holding the committed `manifest.json` and PNGs. */
  against: string;
  thresholdPct?: number;
}

export async function computeDrift(opts: ComputeDriftOptions): Promise<DriftReport> {
  const thresholdPct = opts.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  const committed = variantsOf(await readCommittedPack(opts.against));
  const fresh = variantsOf(opts.fresh.pack);
  const entries: DriftEntry[] = [];
  let compared = 0;
  for (const [id, src] of fresh) {
    const old = committed.get(id);
    if (old === undefined) {
      entries.push({ id, status: "new", failing: true });
      continue;
    }
    compared++;
    const freshFile = fileOfSrc(src)!;
    const entry = await compareVariant(
      id,
      fileOfSrc(old)!,
      opts.fresh.files.get(freshFile)!,
      freshFile,
      opts.against,
      thresholdPct,
    );
    if (entry) entries.push(entry);
  }
  for (const id of committed.keys()) {
    if (!fresh.has(id)) entries.push({ id, status: "missing", failing: true });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const failing = entries.filter((e) => e.failing).length;
  const head = `docsxai drift: ${compared} compared, ${failing} over threshold (${thresholdPct}%)`;
  return {
    compared,
    failing,
    thresholdPct,
    entries,
    text: [head, ...entries.map((e) => `  ${describe(e)}`)].join("\n"),
  };
}
