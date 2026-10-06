// Fixtures for the pack tests: raw capture directories, workspaces with a pack.json, a stand-in
// burner that needs no rasteriser, and a shell-free stand-in for the `oxipng` binary.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { crc32 } from "node:zlib";
import type { AnnotationRecord } from "../../src/annotations.js";
import type { Burner } from "../../src/pack-build.js";
import { decodePng, encodePng, solidPng } from "./png.js";

export type Localized = Record<string, string>;

export interface RawVariantSpec {
  png: Buffer;
  /** Written as the sidecar; `width` and `height` default to the PNG's. */
  sidecar?: Record<string, unknown>;
  /** Skip writing the sidecar. */
  noSidecar?: boolean;
}

export interface RawStepSpec {
  alt: Localized;
  caption?: Localized;
  variants: Record<string, RawVariantSpec>;
}

export interface RawFlowSpec {
  title?: Localized;
  steps: Record<string, RawStepSpec>;
}

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** Writes `<root>/<flow>/<step>/<key>.png|.json`, `step.json` and `flow.json`. */
export async function writeRawCapture(
  root: string,
  flows: Record<string, RawFlowSpec>,
): Promise<void> {
  for (const [flow, spec] of Object.entries(flows)) {
    const flowDir = path.join(root, flow);
    await fs.mkdir(flowDir, { recursive: true });
    if (spec.title)
      await fs.writeFile(path.join(flowDir, "flow.json"), JSON.stringify({ title: spec.title }));
    for (const [step, stepSpec] of Object.entries(spec.steps)) {
      const stepDir = path.join(flowDir, step);
      await fs.mkdir(stepDir, { recursive: true });
      await fs.writeFile(
        path.join(stepDir, "step.json"),
        JSON.stringify({
          alt: stepSpec.alt,
          ...(stepSpec.caption ? { caption: stepSpec.caption } : {}),
        }),
      );
      for (const [key, variant] of Object.entries(stepSpec.variants)) {
        await fs.writeFile(path.join(stepDir, `${key}.png`), variant.png);
        if (variant.noSidecar) continue;
        await fs.writeFile(
          path.join(stepDir, `${key}.json`),
          JSON.stringify({ ...pngSize(variant.png), annotations: [], ...variant.sidecar }),
        );
      }
    }
  }
}

export const SIZE = { width: 40, height: 30 };
export const light = (rgba: [number, number, number, number] = [235, 235, 235, 255]) =>
  solidPng(SIZE.width, SIZE.height, rgba);

export const BOX = { x: 4, y: 4, width: 12, height: 8 };

/** One flow, two steps; `onboarding/pair` has two variants and two callouts. */
export function sampleRaw(): Record<string, RawFlowSpec> {
  return {
    onboarding: {
      title: { en: "Onboarding", es: "Primeros pasos" },
      steps: {
        pair: {
          alt: { en: "Pairing screen", es: "Pantalla de emparejado" },
          caption: { en: "Pair a host", es: "Empareja un host" },
          variants: {
            "en.light.390": {
              png: light(),
              sidecar: {
                annotations: [
                  { index: 1, copy: "Scan the code", bbox: BOX },
                  { index: 2, copy: "Confirm", bbox: { x: 20, y: 14, width: 10, height: 8 } },
                ],
              },
            },
            "es.dark.1280": { png: light([20, 20, 20, 255]) },
          },
        },
        done: {
          alt: { en: "All set" },
          variants: { "en.light.390": { png: light([200, 220, 200, 255]) } },
        },
      },
    },
  };
}

/** A burner that marks pixel (0, 0) red when there is anything to draw. No rasteriser involved. */
export const markingBurner: Burner = (png: Buffer, records: AnnotationRecord[]) => {
  const { width, height, rgba } = decodePng(png);
  const marked = new Uint8Array(rgba);
  marked.set([255, 0, 0, 255], 0);
  return Promise.resolve({
    png: records.length > 0 ? encodePng(marked, width, height) : png,
    unplaceable: 0,
  });
};

/** The same image with one ancillary text chunk before IEND: identical pixels, different bytes. */
export function withTextChunk(png: Buffer, text = "optimised"): Buffer {
  const body = Buffer.concat([Buffer.from("tEXt"), Buffer.from(`docsxai\0${text}`)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), length, body, crc, png.subarray(iend)]);
}

export interface OxipngShim {
  command: string;
  /** Argument lists the shim was run with (not counting `--version`), one per call. */
  calls: () => Promise<string[][]>;
}

/**
 * An executable stand-in for oxipng: answers `--version`, and for `... --out <out> <in>` writes a
 * copy of the input with one ancillary text chunk before IEND. Pixels are untouched, bytes (and
 * so the hash) are not, which is what a real lossless optimiser does.
 */
export async function writeOxipngShim(dir: string): Promise<OxipngShim> {
  const command = path.join(dir, "oxipng-shim.mjs");
  const log = path.join(dir, "oxipng-calls.jsonl");
  await fs.writeFile(
    command,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("oxipng 9.0.0 (shim)"); process.exit(0); }
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const input = readFileSync(args[args.length - 1]);
const out = args[args.indexOf("--out") + 1];
const body = Buffer.concat([Buffer.from("tEXt"), Buffer.from("docsxai-shim\\0optimised")]);
const length = Buffer.alloc(4); length.writeUInt32BE(body.length - 4);
const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
const iend = input.length - 12;
writeFileSync(out, Buffer.concat([input.subarray(0, iend), length, body, crc, input.subarray(iend)]));
`,
  );
  await fs.chmod(command, 0o755);
  return {
    command,
    calls: async () =>
      (await fs.readFile(log, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]),
  };
}

export interface WorkspaceSpec {
  /** Capture flow → step → screenshot. */
  shots: Record<string, Record<string, Buffer>>;
  /** Capture flow → annotation records for `annotations.json`. */
  annotations?: Record<string, AnnotationRecord[]>;
  /** The whole `pack.json` as an object. */
  config: Record<string, unknown>;
}

export async function writeWorkspace(ws: string, spec: WorkspaceSpec): Promise<void> {
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(ws, "pack.json"), JSON.stringify(spec.config));
  for (const [flow, steps] of Object.entries(spec.shots)) {
    const flowDir = path.join(ws, "docs", flow);
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    for (const [step, png] of Object.entries(steps)) {
      await fs.writeFile(path.join(flowDir, "screenshots", `${step}.png`), png);
    }
    const annotations = spec.annotations?.[flow];
    if (annotations) {
      await fs.writeFile(
        path.join(flowDir, "annotations.json"),
        JSON.stringify({ schema: "docsxai/annotations@1", flow, annotations }),
      );
    }
  }
}

/** A `pack.json` with the given sources and one `app` flow whose steps all have English alt. */
export function packConfig(
  sources: Record<string, string>,
  steps: string[],
): Record<string, unknown> {
  return {
    schema: "docsxai/pack-config@1",
    sources: Object.fromEntries(
      Object.entries(sources).map(([name, variant]) => [name, { flow: "app", variant }]),
    ),
    flows: {
      app: {
        title: { en: "App" },
        steps: Object.fromEntries(steps.map((s) => [s, { alt: { en: `The ${s} page` } }])),
      },
    },
  };
}
