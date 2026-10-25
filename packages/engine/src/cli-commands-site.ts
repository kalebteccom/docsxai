// `site` — emit an Astro Starlight docs site from the workspace's doc pack. The emitter lives in
// `@docsxai/viewer`; like `burn` and `pack`, this checks the argv edge and runs the viewer's `site`
// command through the shared bin resolution, so one global install reaches it as `docsxai site`.

import { FLOW_NAME } from "./cli-commands-docpack.js";
import { nearestName } from "./cli-help.js";
import { usageError } from "./cli-messages.js";
import { runViewerBin } from "./viewer-bin.js";

/** The value flags other than `--flow`, which repeats; each of these may appear once. */
const VALUED = ["--out", "--title", "--accent", "--lang"];
const FLAGS = [...VALUED, "--build", "--flow"].map((f) => f.slice(2));

interface SiteArgs {
  workspace: string;
  values: Map<string, string>;
  flows: string[];
  build: boolean;
}

/** Parse `site`'s argv. Returns the usage-error message when the argv is malformed. */
function parseSiteArgs(args: string[]): SiteArgs | string {
  const parsed: SiteArgs = { workspace: "", values: new Map(), flows: [], build: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i]!;
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    let inline: string | undefined;
    if (eq > 2) {
      inline = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a === "--build") {
      if (inline !== undefined) return "--build takes no value";
      parsed.build = true;
      continue;
    }
    if (a !== "--flow" && !VALUED.includes(a)) {
      const near = nearestName(a.slice(2), FLAGS);
      return `unknown flag ${a}${near ? `, did you mean --${near}?` : ""}`;
    }
    const value = inline ?? args[++i];
    if (value === undefined || value === "" || value.startsWith("--")) return `${a} needs a value`;
    if (a === "--flow") {
      if (!FLOW_NAME.test(value)) return `--flow "${value}" is not a flow name`;
      parsed.flows.push(value);
    } else {
      if (parsed.values.has(a)) return `${a} given more than once`;
      parsed.values.set(a, value);
    }
  }
  if (positionals.length === 0) return "missing <workspace-dir>";
  if (positionals.length > 1) return `unexpected argument "${positionals[1]}"`;
  parsed.workspace = positionals[0]!;
  return parsed;
}

/** `site` — run the viewer's `site` with the flags given; its exit code is this command's. */
export async function cmdSite(args: string[]): Promise<number> {
  const parsed = parseSiteArgs(args);
  if (typeof parsed === "string") return usageError("site", parsed);
  const valued = (flag: string): string[] => {
    const value = parsed.values.get(flag);
    return value === undefined ? [] : [flag, value];
  };
  return runViewerBin("site", [
    "site",
    parsed.workspace,
    ...valued("--out"),
    ...(parsed.build ? ["--build"] : []),
    ...valued("--title"),
    ...valued("--accent"),
    ...valued("--lang"),
    ...parsed.flows.flatMap((f) => ["--flow", f]),
  ]);
}
