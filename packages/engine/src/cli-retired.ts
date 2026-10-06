// CLI commands that were valid and are retired. `main` looks a command up here before it
// dispatches: a retired command prints one deprecation warning and runs its replacement, so a
// script that still calls it keeps working for the deprecation window. Retired commands are not
// listed in `--help`.

import { type RetiredEntry } from "./deprecation.js";

export interface RetiredCommand extends RetiredEntry {
  /** The argv of the replacement command, from the arguments the retired one was given. */
  rewrite(args: string[]): string[];
}

export const RETIRED_COMMANDS: Readonly<Record<string, RetiredCommand>> = {
  drift: {
    since: "0.3.0",
    replacement: "`docsxai pack --check`",
    note: "same flags, `--check` added",
    rewrite: (args) => ["pack", ...args, "--check"],
  },
};
