// Flow matrix schema: the `matrix:` block, the `only:` / `skip:` variant selectors, and the
// `variant` record `annotations.json` carries. A leaf module (imports zod and the environment
// schema); `doc-pack.ts` re-exports it. Expansion itself lives in `flow-matrix.ts`.

import { z } from "zod";
import {
  ColorScheme,
  LocaleTag,
  VIEWPORT_PRESETS,
  ViewportPreset,
  type ViewportSize,
} from "./environment-spec.js";

/** Most variants one flow may expand to. A flow over the cap is rejected at parse time. */
export const MAX_MATRIX_VARIANTS = 64;

/** A viewport's matrix name: also a directory segment, so no dots, slashes or capitals. */
const ViewportName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase letters, digits and dashes (e.g. mobile-390)");

/** A matrix viewport: a preset name, or a size with an optional name (default `<width>x<height>`). */
export const MatrixViewport = z.union([
  ViewportPreset,
  z
    .object({
      name: ViewportName.optional(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
]);
export type MatrixViewport = z.infer<typeof MatrixViewport>;

/** A matrix viewport with its name and size spelled out. */
export interface ResolvedMatrixViewport extends ViewportSize {
  name: string;
}

export function resolveMatrixViewport(entry: MatrixViewport): ResolvedMatrixViewport {
  if (typeof entry === "string") return { name: entry, ...VIEWPORT_PRESETS[entry] };
  return {
    name: entry.name ?? `${entry.width}x${entry.height}`,
    width: entry.width,
    height: entry.height,
  };
}

const axisList = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).max(MAX_MATRIX_VARIANTS);

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * The `matrix:` block of a flow-file. Each axis is a bounded list; the flow expands to the product
 * of the axes it names. Locale and viewport entries must be unique (locales ignoring case,
 * viewports by name), and the product may not pass {@link MAX_MATRIX_VARIANTS}.
 */
export const MatrixSpec = z
  .object({
    locales: axisList(LocaleTag).optional(),
    color_schemes: axisList(ColorScheme).optional(),
    viewports: axisList(MatrixViewport).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const sizes = [m.locales, m.color_schemes, m.viewports].map((l) => l?.length);
    if (sizes.every((n) => n === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "`matrix` needs at least one of `locales`, `color_schemes`, `viewports`",
      });
      return;
    }
    const lists: Array<[string, string[] | undefined]> = [
      ["locales", m.locales?.map((l) => l.toLowerCase())],
      ["color_schemes", m.color_schemes],
      ["viewports", m.viewports?.map((v) => resolveMatrixViewport(v).name)],
    ];
    for (const [key, values] of lists) {
      const dupes = values ? duplicates(values) : [];
      if (dupes.length) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `duplicate entries: ${dupes.map((d) => `"${d}"`).join(", ")}`,
        });
      }
    }
    const product = sizes.reduce<number>((n, s) => n * (s ?? 1), 1);
    if (product > MAX_MATRIX_VARIANTS) {
      ctx.addIssue({
        code: "custom",
        message: `matrix expands to ${product} variants (${sizes
          .map((s, i) => `${["locales", "color_schemes", "viewports"][i]}: ${s ?? 0}`)
          .join(", ")}); the limit is ${MAX_MATRIX_VARIANTS}`,
      });
    }
  });
export type MatrixSpec = z.infer<typeof MatrixSpec>;

/**
 * Which variants a step or annotation applies to (`only`) or is dropped from (`skip`). A clause
 * names axes; it matches a variant when every axis it names matches (any value in the list).
 * `viewport` values are matrix viewport names, `locale` values match exactly or by language
 * (`es` matches `es-ES`).
 */
export const VariantSelector = z
  .object({
    viewport: z.array(ViewportName).min(1).optional(),
    color_scheme: z.array(ColorScheme).min(1).optional(),
    locale: z.array(LocaleTag).min(1).optional(),
  })
  .strict()
  .refine((s) => Object.keys(s).length > 0, {
    message: "name at least one of `viewport`, `color_scheme`, `locale`",
  });
export type VariantSelector = z.infer<typeof VariantSelector>;

/** The variant a run executed, recorded as `variant` in `annotations.json`. */
export const VariantInfo = z
  .object({
    id: z.string().min(1),
    locale: LocaleTag.optional(),
    color_scheme: ColorScheme.optional(),
    viewport: z
      .object({
        name: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type VariantInfo = z.infer<typeof VariantInfo>;
