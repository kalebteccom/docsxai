// Name rules a flow name shares with the file system it lands on: Windows device names, a
// trailing dot, and two names that are one directory on a case-insensitive disk. Pure, so the
// schema (`FlowName`), the pull validator and the loaders that gather a set of names all agree.

const WINDOWS_DEVICE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * True when Windows would treat `name` as a device: the part before the first `.` is `con`, `prn`,
 * `aux`, `nul`, `com1`-`com9` or `lpt1`-`lpt9`, in any case. `con`, `CON.v2` and `lpt1.flow` all
 * qualify, `console` does not.
 */
export function isWindowsDeviceName(name: string): boolean {
  return WINDOWS_DEVICE_STEM.test(name.split(".", 1)[0] ?? "");
}

/** True when `name` ends in a dot, which Windows drops from a file name. */
export function hasTrailingDot(name: string): boolean {
  return name.endsWith(".");
}

/**
 * The first two names in `names` that differ only by case, in the order given, or null. Exact
 * duplicates are not a collision. A case-insensitive disk (macOS, Windows) writes both to one path.
 */
export function findCaseCollision(names: Iterable<string>): [string, string] | null {
  const seen = new Map<string, string>();
  for (const name of names) {
    const key = name.toLowerCase();
    const earlier = seen.get(key);
    if (earlier !== undefined && earlier !== name) return [earlier, name];
    if (earlier === undefined) seen.set(key, name);
  }
  return null;
}

/** Throws an `Error` naming the colliding pair, or returns. `what` reads as "flow names", "variant ids". */
export function assertNoCaseCollision(names: Iterable<string>, what: string): void {
  const pair = findCaseCollision(names);
  if (pair) {
    throw new Error(
      `${what} "${pair[0]}" and "${pair[1]}" differ only by case and would share one directory on a case-insensitive disk; rename one`,
    );
  }
}
