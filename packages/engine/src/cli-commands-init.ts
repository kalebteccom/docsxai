// `docsxai init`: scaffold a workspace, and with --example write the hello flow for example.com so
// `run` and `render --open` are all that's left. Split from cli-commands-session.ts.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { bareValueFlagExit, isHttpUrl } from "./cli-shared.js";
import { parseCommandFlags } from "./cli-flags.js";
import {
  describeFsError,
  sanitizeForTerminal,
  shellQuote,
  usageError,
  withNext,
} from "./cli-messages.js";
import { initStyleIfAbsent } from "./style.js";
import { initWorkspace, resolveWorkspacePath } from "./workspace.js";
import { EXAMPLE_APP_URL, EXAMPLE_FLOW, EXAMPLE_FLOW_PATH } from "./workspace-templates.js";

/** The flags of `init` that take a value. */
const INIT_VALUE_FLAGS = [
  "app-url",
  "auth",
  "role",
  "ttl",
  "capture-trigger",
  "auth-cookie",
  "persist",
];

/** The `init` flags `--example` rules out: it sets its own app URL and needs no login. */
const EXAMPLE_EXCLUDES = ["app-url", "auth", "role", "ttl", "capture-trigger", "auth-cookie"];

/** Write the `init --example` flow and the default style. Returns the paths, relative to `dir`. */
async function writeExampleFlow(dir: string): Promise<string[]> {
  await fs.writeFile(resolveWorkspacePath(dir, EXAMPLE_FLOW_PATH), EXAMPLE_FLOW, "utf8");
  const { created } = await initStyleIfAbsent(dir);
  return [EXAMPLE_FLOW_PATH, ...(created ? ["docs/style.yaml"] : [])];
}

export async function cmdInit(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("init", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  const persistTmp = flags.get("persist") === "tmp";
  const dir = positionals[0];
  const bareInit = bareValueFlagExit("init", flags, INIT_VALUE_FLAGS);
  if (bareInit !== undefined) return bareInit;
  const persist = flags.get("persist");
  if (persist !== undefined && persist !== "tmp") {
    return usageError("init", `--persist must be "tmp" (got "${String(persist)}")`);
  }
  if (!persistTmp && !dir)
    return usageError("init", "missing <workspace-dir> (or use --persist tmp)");
  const example = flags.get("example") === true;
  const clash = example ? EXAMPLE_EXCLUDES.find((k) => flags.has(k)) : undefined;
  if (clash) return usageError("init", `--example can't be combined with --${clash}`);
  const str = (k: string): string | undefined =>
    typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined;
  const auth = example ? "none" : str("auth");
  if (auth !== undefined && auth !== "manual-capture" && auth !== "none") {
    return usageError(
      "init",
      `--auth must be manual-capture or none (got "${sanitizeForTerminal(auth)}")`,
    );
  }
  const trigger = str("capture-trigger");
  if (trigger !== undefined && trigger !== "console" && trigger !== "button") {
    return usageError(
      "init",
      `--capture-trigger must be console or button (got "${sanitizeForTerminal(trigger)}")`,
    );
  }
  const appUrl = example ? EXAMPLE_APP_URL : str("app-url");
  if (appUrl !== undefined && !isHttpUrl(appUrl)) {
    return usageError("init", "--app-url must be an http:// or https:// URL");
  }
  const role = str("role");
  const ttl = str("ttl");
  const authCookie = str("auth-cookie");
  if (dir && (await fs.stat(dir).catch(() => null))?.isFile()) {
    const next = "docsxai init <new-dir>  (a workspace is a directory)";
    process.stderr.write(
      `init: ${withNext(`${path.resolve(dir)} is a file, not a directory`, next)}\n`,
    );
    return 1;
  }
  try {
    const r = await initWorkspace({
      ...(dir ? { dir } : {}),
      persistTmp,
      ...(appUrl ? { appUrl } : {}),
      ...(auth ? { auth } : {}),
      ...(role ? { role } : {}),
      ...(ttl ? { ttl } : {}),
      ...(trigger ? { captureTrigger: trigger } : {}),
      ...(authCookie ? { authCookie } : {}),
      ignoreHttpsErrors: flags.get("ignore-https-errors") === true,
      force: flags.get("force") === true,
    });
    if (example) r.created.push(...(await writeExampleFlow(r.dir)));
    process.stdout.write(
      `init: workspace ${r.ephemeral ? "(ephemeral) " : ""}at ${r.dir}\n  created: ${r.created.join(", ")}\n`,
    );
    const dirArg = shellQuote(r.dir);
    if (example) {
      process.stdout.write(`  next: docsxai run ${dirArg}  →  docsxai render ${dirArg} --open\n`);
      return 0;
    }
    // An `--auth none` workspace has no auth descriptor, so capture-auth has nothing to run.
    const login = auth === "none" ? "" : `docsxai capture-auth ${dirArg}  →  `;
    process.stdout.write(
      `  next: ${appUrl ? "" : "(set app_url in .docsxai.json, then) "}${login}docsxai calibrate ${dirArg} --from <flow.yaml>  →  docsxai run ${dirArg}  →  docsxai render ${dirArg}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(
      `init: ${describeFsError(e, { creating: true }) ?? (e as Error).message.replace(/^init: /, "")}\n`,
    );
    return 1;
  }
}
