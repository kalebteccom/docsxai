// The flags each command accepts, and the parse that holds argv to them. An unknown flag is a usage
// error with a "did you mean" when one is close, a flag given twice is a usage error, and a boolean
// flag never takes the next argument as its value (`run --pause ws` keeps `ws` as the workspace).
// Commands with their own argv loop (`burn`, `pack`) check their flags there.
// Leaf module: imports only the help and message helpers.

import { nearestName } from "./cli-help.js";
import { usageError } from "./cli-messages.js";
import { parseFlags } from "./cli-shared.js";

export interface CommandFlags {
  /** Flags that take a value. A bare one is rejected by the command's own value check. */
  value: readonly string[];
  /** Flags that take no value. */
  bool: readonly string[];
  /** Flags a handler validates itself, because it words a specific error for a value or a bare use. */
  loose?: readonly string[];
}

const RUN_VALUE = [
  "flow",
  "base-url",
  "stop-after",
  "start-from",
  "variant",
  "cdp",
  "concurrency",
  "runs",
  "format",
  "device-scale-factor",
];

/** Every command that reads its argv through {@link parseCommandFlags}, with the flags in `--help`. */
export const COMMAND_FLAGS: Readonly<Record<string, CommandFlags>> = {
  init: {
    value: ["app-url", "auth", "role", "ttl", "capture-trigger", "auth-cookie", "persist"],
    bool: ["ignore-https-errors", "force"],
  },
  calibrate: { value: ["from", "name"], bool: [] },
  inspect: {
    value: ["url", "selector", "cdp", "wait", "wait-for", "role"],
    bool: ["headed", "ignore-https-errors"],
  },
  run: {
    value: RUN_VALUE,
    bool: ["headed", "ignore-https-errors", "pause"],
    loose: ["verify-determinism"],
  },
  lint: { value: ["flow", "format"], bool: [] },
  "flow-tree": { value: ["format"], bool: [] },
  diagnose: { value: ["flow", "step", "cdp", "variant", "format"], bool: [] },
  style: { value: ["format"], bool: ["check"] },
  zip: { value: ["out"], bool: ["include-viewer"] },
  baseline: { value: ["out"], bool: [] },
  diff: { value: ["against", "format", "fail-on"], bool: [] },
  "export adf": { value: ["mode", "flow", "title", "out"], bool: [] },
  "export playwright": { value: ["flow", "out"], bool: [] },
  plugins: { value: ["format"], bool: [] },
  doctor: { value: [], bool: ["offline"] },
  render: { value: [], bool: [] },
  login: { value: ["backend-url"], bool: [], loose: ["oauth"] },
  push: { value: ["kind", "author"], bool: [] },
  pull: { value: ["rev"], bool: [] },
  "capture-auth": {
    value: ["base-url", "role", "auth-cookie", "cdp"],
    bool: ["fresh", "headless", "ignore-https-errors"],
  },
};

type Parsed = Pick<ReturnType<typeof parseFlags>, "positionals" | "flags">;

/**
 * Parse `args` for `label` (the key into {@link COMMAND_FLAGS} unless `spec` names another).
 * Returns the parsed argv, or exit code 2 after the usage error.
 */
export function parseCommandFlags(label: string, args: string[], spec = label): Parsed | number {
  const known = COMMAND_FLAGS[spec];
  if (!known) throw new Error(`no flag table for ${spec}`);
  const { positionals, flags, repeated, boolWithValue } = parseFlags(args, known.bool);
  const all = [...known.value, ...known.bool, ...(known.loose ?? [])];
  const unknown = [...flags.keys()].find((k) => !all.includes(k));
  if (unknown !== undefined) {
    const near = nearestName(unknown, all);
    return usageError(label, `unknown flag --${unknown}${near ? `, did you mean --${near}?` : ""}`);
  }
  if (boolWithValue[0]) return usageError(label, `--${boolWithValue[0]} takes no value`);
  if (repeated[0]) return usageError(label, `--${repeated[0]} given more than once`);
  return { positionals, flags };
}
