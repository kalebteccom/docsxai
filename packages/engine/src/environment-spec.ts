// Execution-environment schema: the `environment:` block of a flow-file and the viewport shapes a
// matrix axis reuses. A leaf module (imports only zod) so `doc-pack.ts` and `matrix-spec.ts` can
// both depend on it; `doc-pack.ts` re-exports everything here, so importers are unchanged.

import { z } from "zod";

export const ViewportSize = z
  .object({ width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();
export type ViewportSize = z.infer<typeof ViewportSize>;

export const ViewportPreset = z.enum(["desktop", "tablet", "mobile"]);
export type ViewportPreset = z.infer<typeof ViewportPreset>;

/** Named viewport presets — `desktop` 1440×900, `tablet` 834×1112, `mobile` 390×844. */
export const VIEWPORT_PRESETS: Record<ViewportPreset, ViewportSize> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

/** BCP-47 language tag (e.g. `en-GB`); shared by `environment.locale`, matrix locales and `copy_by_locale` keys. */
export const LocaleTag = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/, "must be a BCP-47 language tag (e.g. en-GB)");

export const ColorScheme = z.enum(["light", "dark"]);
export type ColorScheme = z.infer<typeof ColorScheme>;

/**
 * Deterministic execution environment for a flow. All fields optional; applied at browser-context
 * creation (so the whole flow runs under them). With `extends`, the child flow's `environment`
 * wins per-key over the parent's (a child can pin just `viewport` and inherit the parent's clock).
 */
export const EnvironmentSpec = z
  .object({
    /** ISO-8601 instant the page clock is frozen at — `new Date()` etc. return this for the whole run. */
    clock: z.string().datetime({ offset: true, local: true }).optional(),
    /** BCP-47 language tag (e.g. `en-GB`). */
    locale: LocaleTag.optional(),
    /** IANA timezone (e.g. `Europe/Amsterdam`). */
    timezone: z.string().min(1).optional(),
    /** `{ width, height }` in CSS pixels, or a named preset — see {@link VIEWPORT_PRESETS}. */
    viewport: z.union([ViewportPreset, ViewportSize]).optional(),
    color_scheme: ColorScheme.optional(),
    reduced_motion: z.boolean().optional(),
  })
  .strict();
export type EnvironmentSpec = z.infer<typeof EnvironmentSpec>;

/**
 * The stderr line for a CDP attach, which cannot apply context-level settings to a context the
 * operator owns: names every `environment` field and the `contextOptions` that were skipped.
 * `undefined` when nothing was skipped. The clock is a page-level install, so it still applies.
 */
export function attachSkipNotice(
  env: EnvironmentSpec | undefined,
  hasContextOptions: boolean,
): string | undefined {
  const fields = (["locale", "timezone", "viewport", "color_scheme", "reduced_motion"] as const)
    .filter((k) => env?.[k] !== undefined)
    .map((k) => `environment.${k}`);
  if (hasContextOptions) fields.push("contextOptions");
  return fields.length
    ? `launchPlaywrightSession: attached over CDP, where the browser context is externally owned; skipped: ${fields.join(", ")}\n`
    : undefined;
}
