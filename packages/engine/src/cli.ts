#!/usr/bin/env node
// `site-docs` — the deterministic CLI (the agent-invoked surface; the plugin's `run`/`render`/… wrap this).
//
// Phase-0 scope: `run` (execute a project's flow-files headlessly, re-emit annotations + screenshots) and
// `render` (build the viewer — stubbed until the viewer package exists). Calibration subcommands run in an
// agent context and are exposed by the plugin, not here.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseAuthStrategyFile, LocalStorageStateCache, type StorageState } from "./auth.js";
import { parseFlowFile } from "./flow-file.js";
import { runFlow } from "./flow-runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";

const USAGE = `site-docs — deterministic execution CLI

Usage:
  site-docs run <project-dir> [--flow <name>] [--base-url <url>] [--headed]
  site-docs render <project-dir>
  site-docs --help

Notes:
  • <project-dir> holds flows/<flow>.flow.yaml and (optionally) auth/strategy.yaml.
  • run launches Chromium; if no browser binary is present, install one:  npx playwright install chromium
  • Calibration (calibrate/diagnose/style-learn) runs in an agent context — see the plugin, not this CLI.`;

function parseFlags(args: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

async function listFlowFiles(projectDir: string): Promise<string[]> {
  const dir = path.join(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`no flows directory at ${dir}`);
  }
  return entries.filter((e) => e.endsWith(".flow.yaml")).sort().map((e) => path.join(dir, e));
}

async function loadAuthStorageState(projectDir: string): Promise<StorageState | undefined> {
  const descriptorPath = path.join(projectDir, "auth", "strategy.yaml");
  let text: string;
  try {
    text = await fs.readFile(descriptorPath, "utf8");
  } catch {
    return undefined; // no auth configured — run with a fresh context
  }
  const descriptor = parseAuthStrategyFile(text, descriptorPath);
  const role = descriptor.default_role;
  const cache = new LocalStorageStateCache(path.join(projectDir, ".auth"));
  const state = await cache.load(role);
  if (!state) {
    throw new Error(
      `auth/strategy.yaml configures role "${role}" but no valid cached session was found at ${path.join(projectDir, ".auth", role + ".json")}.\n` +
        `Capture one first (calibration's auth step, e.g. the manual-capture flow).`,
    );
  }
  return state;
}

async function cmdRun(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("run: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const onlyFlow = typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const baseURL = typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined;
  const headed = flags.get("headed") === true;

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }
  const flows = [];
  for (const fp of flowPaths) {
    const flow = parseFlowFile(await fs.readFile(fp, "utf8"), fp);
    if (!onlyFlow || flow.name === onlyFlow) flows.push(flow);
  }
  if (flows.length === 0) {
    process.stderr.write(onlyFlow ? `run: no flow named "${onlyFlow}"\n` : `run: no flow-files in ${projectDir}/flows\n`);
    return 1;
  }

  let storageState: StorageState | undefined;
  try {
    storageState = await loadAuthStorageState(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }

  let session;
  try {
    session = await launchPlaywrightSession({ baseURL, headed, storageState, docPackRoot: projectDir });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)) {
      process.stderr.write(`run: no Chromium binary found.\n  Install one:  npx playwright install chromium\n`);
      return 1;
    }
    process.stderr.write(`run: failed to launch browser: ${msg}\n`);
    return 1;
  }

  try {
    for (const flow of flows) {
      const result = await runFlow(flow, session.driver, { resolveLocator: (n) => flow.locators[n] });
      const docsDir = path.join(projectDir, "docs", flow.name);
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(
        path.join(docsDir, "annotations.json"),
        JSON.stringify(result.annotations, null, 2) + "\n",
        "utf8",
      );
      process.stdout.write(`run: ${flow.name} — ${result.steps.length} steps, ${result.annotations.annotations.length} annotation(s)\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  } finally {
    await session.close();
  }
}

async function cmdRender(args: string[]): Promise<number> {
  const { positionals } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("render: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const docsDir = path.join(projectDir, "docs");
  const outDir = path.join(projectDir, ".viewer");
  // The viewer is its own package/bin; shell out to it so the engine doesn't depend on it at build time.
  return new Promise<number>((resolve) => {
    const child = spawn("site-docs-viewer", ["build", docsDir, outDir], { stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        process.stderr.write(
          "render: `site-docs-viewer` not found on PATH.\n" +
            `  Run it directly:  site-docs-viewer build ${docsDir} ${outDir}\n` +
            "  (it's the @kalebtec/site-docs-viewer bin; in this workspace: pnpm exec site-docs-viewer …)\n",
        );
      } else {
        process.stderr.write(`render: ${e.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE + "\n");
      return 0;
    case "run":
      return cmdRun(rest);
    case "render":
      return cmdRender(rest);
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`);
      return 2;
  }
}

// Run as the bin entry, but not when imported (e.g. in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
