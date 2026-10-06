// Deprecation warnings: the code behind the policy in docs/public-surface.md. An input that was
// valid and is being retired (a CLI command or flag, a flow-file field, a config key, an
// environment variable) keeps working for at least one minor release and prints one warning per
// invocation: `docsxai: <item> is deprecated since <version>, use <replacement>`. The registry
// shape and the accept-warn-ignore rule are in docs/ai-context/release-process/retired-registry-pattern.md.
// An unknown input is not here: it is a typo and stays a loud error.

export interface RetiredEntry {
  /** The release that deprecated it. */
  since: string;
  /** What to use instead. Omitted when nothing replaces it. */
  replacement?: string;
  /** One extra clause, for example why. */
  note?: string;
}

/** The warning line (without a trailing newline) for a retired `item`. */
export function deprecationMessage(item: string, entry: RetiredEntry): string {
  const use = entry.replacement ? `, use ${entry.replacement}` : "";
  const note = entry.note ? ` (${entry.note})` : "";
  return `docsxai: ${item} is deprecated since ${entry.since}${use}${note}`;
}

const warned = new Set<string>();

/**
 * Print the warning for `item` to stderr, once per process. Returns whether it printed. `write`
 * is injectable for tests and for hosts that route diagnostics elsewhere.
 */
export function warnDeprecated(
  item: string,
  entry: RetiredEntry,
  write: (line: string) => void = (line) => void process.stderr.write(line),
): boolean {
  if (warned.has(item)) return false;
  warned.add(item);
  write(`${deprecationMessage(item, entry)}\n`);
  return true;
}

/** Forget which items already warned. For tests; a CLI invocation is one process. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}

/** Look `name` up as an own key of a retired registry, so `constructor` and `toString` are never retired. */
export function findRetired<T extends RetiredEntry>(
  registry: Readonly<Record<string, T>>,
  name: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
}
