// Source to pack, in memory: burn each screenshot, optimise it, hash the final bytes, and
// assemble the `docsxai/screens-pack@2` manifest. Nothing is written here; `pack-write.ts` does
// that, and `docsxai drift` compares this result against a committed pack instead.

import { createHash } from "node:crypto";
import type { AnnotationRecord } from "./annotations.js";
import { pngDimensions, renderBurn } from "./burn.js";
import { assertGuarded } from "./pack-guards.js";
import { identityOptimiser, type Optimiser } from "./pack-optimise.js";
import {
  DEFAULT_PUBLIC_PREFIX,
  SCREENS_PACK_SCHEMA,
  normalisePublicPrefix,
  packFilePath,
  serialisePack,
  type PackFlow,
  type PackStep,
  type ScreensPack,
} from "./pack-schema.js";
import type { PackSource, SourceStep, SourceVariant } from "./pack-source.js";
import { assertValidPack } from "./pack-validate.js";

type Warn = (message: string) => void;

/** Draws a step's annotations onto its clean screenshot. */
export type Burner = (
  png: Buffer,
  records: AnnotationRecord[],
  warn: Warn,
) => Promise<{ png: Buffer; unplaceable: number }>;

/** The viewer's own burner: halo, badge, callout and arrow, with obstacles and placement as the records carry them. */
export const viewerBurner: Burner = async (png, records, warn) => {
  const r = await renderBurn({ screenshotBuffer: png, annotations: records, options: { warn } });
  return { png: r.png, unplaceable: r.report.filter((a) => a.unplaceable).length };
};

export interface BuildPackOptions {
  source: PackSource;
  /** Default: {@link viewerBurner}. */
  burn?: Burner;
  /** Default: leave the burned bytes as they are. */
  optimise?: Optimiser;
  /** Default `/screens`. */
  publicPrefix?: string;
  /** Free text naming what the pack was built for (a commit sha, a build id). Omitted when unset. */
  generatedFor?: string;
  warn?: Warn;
}

export interface BuiltPack {
  pack: ScreensPack;
  /** `<flow>/<step>.<hash8>.png` → final bytes. */
  files: Map<string, Buffer>;
  /** The canonical manifest text. */
  manifestText: string;
  /** Callouts the burner found no clear spot for (drawn anyway). */
  unplaceable: number;
}

export const hash8 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 8);

interface Rendered {
  relative: string;
  bytes: Buffer;
  unplaceable: number;
}

async function renderVariant(
  flow: string,
  step: SourceStep,
  variant: SourceVariant,
  opts: Required<Pick<BuildPackOptions, "burn" | "optimise" | "warn">>,
): Promise<Rendered> {
  const label = `${flow}/${step.id}/${variant.key}`;
  const rawSize = pngDimensions(variant.png);
  let burned = variant.png;
  let unplaceable = 0;
  if (variant.annotations.length > 0) {
    const r = await opts.burn(variant.png, variant.annotations, (m) => opts.warn(`${label}: ${m}`));
    burned = r.png;
    unplaceable = r.unplaceable;
  }
  const bytes = await opts.optimise(burned);
  const size = pngDimensions(bytes);
  if (size.width !== rawSize.width || size.height !== rawSize.height) {
    throw new Error(
      `${label}: output is ${size.width}x${size.height}, capture is ${rawSize.width}x${rawSize.height}`,
    );
  }
  return { relative: packFilePath(flow, step.id, hash8(bytes)), bytes, unplaceable };
}

/** Burns, optimises, hashes and assembles. Throws when the pack is invalid or a guard trips. */
export async function buildPack(options: BuildPackOptions): Promise<BuiltPack> {
  const prefix = normalisePublicPrefix(options.publicPrefix ?? DEFAULT_PUBLIC_PREFIX);
  const opts = {
    burn: options.burn ?? viewerBurner,
    optimise: options.optimise ?? identityOptimiser,
    warn: options.warn ?? ((m: string) => console.warn(m)),
  };
  const files = new Map<string, Buffer>();
  const flows: Record<string, PackFlow> = {};
  let unplaceable = 0;
  for (const flow of options.source) {
    const steps: Record<string, PackStep> = {};
    for (const step of flow.steps) {
      const variants: PackStep["variants"] = {};
      for (const variant of step.variants) {
        const r = await renderVariant(flow.id, step, variant, opts);
        files.set(r.relative, r.bytes);
        unplaceable += r.unplaceable;
        const size = pngDimensions(r.bytes);
        variants[variant.key] = {
          src: `${prefix}/${r.relative}`,
          width: size.width,
          height: size.height,
          bytes: r.bytes.length,
          callouts: variant.callouts,
        };
      }
      steps[step.id] = {
        ...(step.caption ? { caption: step.caption } : {}),
        alt: step.alt,
        variants,
      };
    }
    flows[flow.id] = { ...(flow.title ? { title: flow.title } : {}), steps };
  }
  const pack: ScreensPack = {
    schema: SCREENS_PACK_SCHEMA,
    ...(options.generatedFor ? { generated_for: options.generatedFor } : {}),
    flows,
  };
  assertValidPack(pack, { publicPrefix: prefix });
  assertGuarded(pack);
  return { pack, files, manifestText: serialisePack(pack), unplaceable };
}
