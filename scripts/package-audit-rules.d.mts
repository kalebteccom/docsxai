export const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }>;
export function requiredPaths(
  cwd: string,
  pkg: { name?: string; main?: string; bin?: string | Record<string, string> },
): string[];
export function missingPaths(packed: string[], required: string[]): string[];
