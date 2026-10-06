#!/usr/bin/env node
// Fake `docsxai` engine bin for webhook tests. Supports the two subcommands the webhook
// surface spawns (`run`, `render`); writes canned artifacts so tests can assert it really ran.
// FAKE_ENGINE_EXIT forces a non-zero exit to exercise failure paths.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const cmd = process.argv[2];
// Like the real engine: the workspace is the first positional argument after the command.
const workspace = process.argv[3];
if (!workspace || workspace.startsWith("--")) {
  console.error(`fake engine: ${cmd}: missing <project-dir>`);
  process.exit(2);
}

if (process.env.FAKE_ENGINE_EXIT) {
  process.stdout.write(`fake engine forced exit ${process.env.FAKE_ENGINE_EXIT}` + "\n");
  process.exit(Number(process.env.FAKE_ENGINE_EXIT));
}

if (cmd === "run") {
  fs.writeFileSync(
    path.join(workspace, "fake-run.json"),
    JSON.stringify({ ran: true, argv: process.argv.slice(2) }, null, 2),
  );
  process.stdout.write("documented 3 flows, 0 drifted" + "\n");
  process.exit(0);
}

if (cmd === "render") {
  // The real `render` writes to <workspace>/.viewer and takes no --out.
  const out = path.join(workspace, ".viewer");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), "<html>fake viewer</html>");
  process.stdout.write("viewer rendered" + "\n");
  process.exit(0);
}

console.error(`fake engine: unknown command "${cmd}"`);
process.exit(2);
