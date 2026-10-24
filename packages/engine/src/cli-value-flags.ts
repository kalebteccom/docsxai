// The flags that take a value, per command. One of them given with nothing after it (`zip ws --out`)
// is a usage error: reading it as a boolean would run the command as if the flag was absent. `run`,
// `baseline`, `diff` and `pack` check their own flags. Leaf: imports only the flag parser.

import { flagMissingValue, parseFlags } from "./cli-shared.js";

const VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  init: ["app-url", "auth", "role", "ttl", "capture-trigger", "auth-cookie", "persist"],
  calibrate: ["from", "name"],
  inspect: ["url", "selector", "cdp", "wait", "wait-for", "role"],
  lint: ["flow", "format"],
  "flow-tree": ["format"],
  diagnose: ["flow", "step", "variant", "cdp", "format"],
  style: ["format"],
  zip: ["out"],
  "export adf": ["flow", "mode", "title", "out"],
  "export playwright": ["flow", "out"],
  login: ["backend-url"],
  push: ["kind", "author"],
  pull: ["rev"],
  "capture-auth": ["base-url", "role", "auth-cookie", "cdp"],
};

/**
 * The first value flag of `cmd` that `args` gives with no value, with the label its usage error
 * starts with (`export adf` for `export adf <dir>`). `undefined` when every value flag has one.
 */
export function bareValueFlag(
  cmd: string,
  args: string[],
): { label: string; flag: string } | undefined {
  const label = cmd === "export" ? `export ${args[0] ?? ""}` : cmd;
  if (!Object.hasOwn(VALUE_FLAGS, label)) return undefined;
  const names = VALUE_FLAGS[label]!;
  const flag = flagMissingValue(parseFlags(args).flags, names);
  return flag === undefined ? undefined : { label, flag };
}
