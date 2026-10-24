// The Node version below which the `docsxai` bin cannot start. Playwright refuses to load on
// Node 18 and older with its own text and no exit-code contract; this says what is wrong in the
// CLI's voice before anything else loads. The engine requires Node >= 26 (`doctor` reports that
// for any version); this floor only covers the versions that cannot run at all.

import { withNext } from "./cli-messages.js";

/** Oldest Node major the dependencies load on. */
export const NODE_FLOOR_MAJOR = 20;

/** The stderr text for a Node that is too old to start, or `undefined` when it can. */
export function nodeFloorMessage(version: string): string | undefined {
  const major = Number(version.split(".")[0]);
  if (!Number.isFinite(major) || major >= NODE_FLOOR_MAJOR) return undefined;
  return `docsxai: ${withNext(
    `Node v${version} is too old to start (the engine requires Node >= 26)`,
    "install Node 26 or newer (https://nodejs.org), then rerun the command",
  )}\n`;
}
