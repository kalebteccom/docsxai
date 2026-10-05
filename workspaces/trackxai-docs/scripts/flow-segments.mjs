#!/usr/bin/env node
// Prints one "<first-step> <last-step>" line per page of a flow: a segment starts at each
// `navigate` step and ends before the next one. pipeline.sh runs the segments one at a time so a
// retry repeats a single page, not the whole flow.
// Usage: DOCSXAI=<docsxai checkout> node scripts/flow-segments.mjs <flow-name>
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ws = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsxai = process.env.DOCSXAI;
if (!docsxai) throw new Error("set DOCSXAI to the docsxai checkout");
const { parseFlowFile } = await import(
  pathToFileURL(join(docsxai, "packages/engine/dist/index.js")).href
);
const name = process.argv[2];
const flow = parseFlowFile(readFileSync(join(ws, "flows", `${name}.flow.yaml`), "utf8"), name);
const segments = [];
for (const step of flow.steps) {
  if (step.action === "navigate" || segments.length === 0) segments.push([step.id, step.id]);
  else segments[segments.length - 1][1] = step.id;
}
for (const [first, last] of segments) process.stdout.write(`${first} ${last}\n`);
