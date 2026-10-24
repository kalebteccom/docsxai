// Imported first by cli.ts so it runs before the modules that refuse an old Node on their own.
// Exits 1 with one `docsxai:` line; a Node that can run the CLI passes through untouched.

import { nodeFloorMessage } from "./node-floor.js";

const tooOld = nodeFloorMessage(process.versions.node);
if (tooOld) {
  process.stderr.write(tooOld);
  process.exit(1);
}
