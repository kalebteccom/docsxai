#!/usr/bin/env node
// `docsxai` — the deterministic CLI. The plugin's commands wrap this; calibration runs in an agent
// context and is exposed by the plugin, not here.
//
// Barrel / dispatch: the command bodies live in flat siblings, grouped by cohesion. This file parses
// argv, routes the subcommand to its handler, and re-exports `main` so `./cli.js` callers (the bin,
// the colocated tests) are unchanged. The clusters import shared helpers from cli-shared.ts (a leaf)
// and the help text from cli-usage.ts — no cluster imports back from here, so there's no cycle.
//   • cli-usage.ts             — the USAGE help-text constant
//   • cli-shared.ts            — parseFlags + listFlowFiles (the shared leaf)
//   • cli-commands-session.ts  — init / capture-auth / calibrate / run (live-browser + scaffolding)
//   • cli-commands-authoring.ts — inspect / lint / flow-tree / diagnose / style (calibration aids)
//   • cli-commands-docpack.ts  — render / zip / export / baseline / diff (doc-pack ops)
//   • cli-commands-backend.ts  — login / push / pull / plugins (backend + sync)

import { pathToFileURL } from "node:url";
import { runDoctor } from "./doctor.js";
import { USAGE } from "./cli-usage.js";
import { cmdCalibrate, cmdCaptureAuth, cmdInit, cmdRun } from "./cli-commands-session.js";
import {
  cmdDiagnose,
  cmdFlowTree,
  cmdInspect,
  cmdLint,
  cmdStyle,
} from "./cli-commands-authoring.js";
import { cmdBaseline, cmdDiff, cmdExport, cmdRender, cmdZip } from "./cli-commands-docpack.js";
import { cmdLogin, cmdPlugins, cmdPull, cmdPush } from "./cli-commands-backend.js";

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE + "\n");
      return 0;
    case "init":
      return cmdInit(rest);
    case "calibrate":
      return cmdCalibrate(rest);
    case "inspect":
      return cmdInspect(rest);
    case "run":
      return cmdRun(rest);
    case "render":
      return cmdRender(rest);
    case "capture-auth":
      return cmdCaptureAuth(rest);
    case "lint":
      return cmdLint(rest);
    case "flow-tree":
      return cmdFlowTree(rest);
    case "diagnose":
      return cmdDiagnose(rest);
    case "doctor":
      return runDoctor(rest);
    case "style":
      return cmdStyle(rest);
    case "zip":
      return cmdZip(rest);
    case "baseline":
      return cmdBaseline(rest);
    case "diff":
      return cmdDiff(rest);
    case "export":
      return cmdExport(rest);
    case "plugins":
      return cmdPlugins(rest);
    case "login":
      return cmdLogin(rest);
    case "push":
      return cmdPush(rest);
    case "pull":
      return cmdPull(rest);
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`);
      return 2;
  }
}

// Run as the bin entry, but not when imported (e.g. in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
