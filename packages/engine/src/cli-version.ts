// `docsxai --version` / `-v`: the engine's package version. `package.json` sits one level above
// both `src/` and `dist/`, so the same relative URL works from source and from the build.

import { readFileSync } from "node:fs";

/** The version in the engine's `package.json`, or `unknown` when it can't be read. */
export function engineVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const { version } = JSON.parse(raw) as { version?: unknown };
    if (typeof version === "string") return version;
  } catch {
    // fall through
  }
  return "unknown";
}

/** The flags that print the version. */
export const VERSION_FLAGS: readonly string[] = ["--version", "-v"];

/** Print `docsxai <version>` when `cmd` asks for it. Returns exit code 0, or `undefined` otherwise. */
export function tryVersion(cmd: string | undefined): number | undefined {
  if (cmd === undefined || !VERSION_FLAGS.includes(cmd)) return undefined;
  process.stdout.write(`docsxai ${engineVersion()}\n`);
  return 0;
}
