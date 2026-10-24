// The device scale factor of a `docsxai run`: `--device-scale-factor <1-4>` or, when the flag is
// absent, the DOCSX_DEVICE_SCALE_FACTOR variable. Leaf module, no imports.

export const DEVICE_SCALE_FACTOR_ENV = "DOCSX_DEVICE_SCALE_FACTOR";
export const MIN_DEVICE_SCALE_FACTOR = 1;
export const MAX_DEVICE_SCALE_FACTOR = 4;

/** A whole number or one with a single decimal, from 1 to 4. `undefined` for anything else. */
export function parseDeviceScaleFactor(raw: string): number | undefined {
  if (!/^\d(\.\d)?$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= MIN_DEVICE_SCALE_FACTOR && n <= MAX_DEVICE_SCALE_FACTOR ? n : undefined;
}

/**
 * The factor a run uses: the flag when given, else the variable (empty counts as unset), else
 * `undefined` (the browser default of 1). With `cdp` the variable is ignored and the flag is an error. A bad value is an `error` that names its source.
 */
export function resolveDeviceScaleFactor(
  flagValue: string | boolean | undefined,
  env: NodeJS.ProcessEnv,
  cdp = false,
): { factor: number | undefined } | { error: string } {
  const flag = typeof flagValue === "string" ? flagValue : undefined;
  const fromEnv =
    flag === undefined && env[DEVICE_SCALE_FACTOR_ENV] ? env[DEVICE_SCALE_FACTOR_ENV] : undefined;
  const raw = flag ?? fromEnv;
  if (raw === undefined) return { factor: undefined };
  // An attached browser owns its scale: the flag cannot apply, and the variable is left unused.
  if (cdp) {
    return flag === undefined
      ? { factor: undefined }
      : {
          error:
            "--device-scale-factor cannot be combined with --cdp, the attached browser owns its scale",
        };
  }
  const factor = parseDeviceScaleFactor(raw);
  if (factor !== undefined) return { factor };
  const source = flag !== undefined ? "--device-scale-factor" : DEVICE_SCALE_FACTOR_ENV;
  return {
    error: `${source} must be 1 to 4, a whole number or one with one decimal such as 1.5 (got "${raw}")`,
  };
}
