// Per-call time budgets for the Playwright driver's page calls.

/** Rejects with a timeout error if `work` takes longer than `ms` (no limit when `ms` is undefined). */
export function withTimeout<T>(work: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Playwright per-call options for a step's `timeout_ms`; empty when unset so the default is untouched. */
export function budget(timeoutMs: number | undefined): { timeout?: number } {
  return timeoutMs === undefined ? {} : { timeout: timeoutMs };
}
