// The nightly drift recipes under examples/ci/ run against the sample repo in examples/ci/sample-repo:
// a workspace (`docs-workspace/`, the path the recipes use) with a flow, a committed doc pack and a
// committed baseline, all taken from fixtures the engine and viewer suites already use. Each recipe's
// own `docsxai run ... --verify-determinism` and `docsxai diff ...` lines are extracted from the
// parsed YAML, pointed at a copy of the sample repo and run through the real CLI. The diff step needs
// no browser; the determinism step needs Chromium and skips without it. `docsxai pack` and
// `pack --check` are not in the recipes; they are checked here against the same repo through the real
// viewer bin and skip when the viewer is not built.

import { existsSync, readFileSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { main } from "../src/cli.js";
import { docsxaiCommands, scriptsIn } from "./fixtures/ci-recipe-commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const sampleWorkspace = path.join(repo, "examples", "ci", "sample-repo", "docs-workspace");
const toySiteUrl = pathToFileURL(path.join(here, "fixtures", "toy-site")).href + "/";
const viewerBin = path.join(repo, "packages", "viewer", "dist", "index.js");
const viewerBuilt = existsSync(viewerBin);

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

const RECIPES = [
  "examples/ci/github-actions-nightly-drift.yml",
  "examples/ci/gitlab-ci-nightly-drift.yml",
  "examples/ci/woodpecker-nightly-drift.yml",
];

/** The recipe's `docsxai <verb> ...` line for `verb`, as the pipeline would run it. */
function recipeCommand(file: string, verb: string): string {
  const doc: unknown = parse(readFileSync(path.join(repo, file), "utf8"));
  const found = docsxaiCommands(scriptsIn(doc)).find((c) => c.split(/\s+/)[1] === verb);
  if (!found) throw new Error(`${file}: no \`docsxai ${verb}\` command`);
  return found;
}

/** argv for a recipe command: the pipeline's `./docs-workspace` and `$APP_URL` swapped for the test's. */
function argvFor(command: string, ws: string): string[] {
  const argv = command
    .split(/\s+/)
    .slice(1)
    .map((t) => t.replace(/^"(.*)"$/, "$1"))
    .map((t) => (t === "$APP_URL" ? toySiteUrl : t))
    .map((t) => (t.startsWith("./docs-workspace") ? ws + t.slice("./docs-workspace".length) : t));
  expect(
    argv.filter((t) => t.includes("$")),
    `unresolved variable in: ${command}`,
  ).toEqual([]);
  return argv;
}

function whitePng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

let out = "";
let err = "";
let tmp = "";
let ws = "";

beforeEach(async () => {
  out = "";
  err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-ci-sample-"));
  ws = path.join(tmp, "docs-workspace");
  await fs.cp(sampleWorkspace, ws, { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("sample repo", () => {
  it("holds a flow, a committed doc pack and a committed baseline", () => {
    for (const rel of [
      ".docsxai.json",
      "pack.json",
      "flows/obstacles.flow.yaml",
      "docs/obstacles/annotations.json",
      "docs/obstacles/screenshots/share.png",
      ".baseline/flows/obstacles.flow.yaml",
      ".baseline/docs/obstacles/annotations.json",
      ".baseline/docs/obstacles/screenshots/share.png",
    ]) {
      expect(existsSync(path.join(sampleWorkspace, rel)), rel).toBe(true);
    }
  });

  it("lints without a usage or parse failure", async () => {
    expect(await main(["lint", ws])).toBeLessThan(2);
  });
});

describe.each(RECIPES)("%s against the sample repo", (file) => {
  it("diff step: the committed pack matches the committed baseline", async () => {
    const code = await main(argvFor(recipeCommand(file, "diff"), ws));
    expect(code, err).toBe(0);
    expect(out).toContain("# docsxai drift report");
    expect(out).toContain("No drift detected.");
  });

  it("diff step: a screenshot whose size changed fails the job", async () => {
    await fs.writeFile(
      path.join(ws, "docs", "obstacles", "screenshots", "share.png"),
      whitePng(2, 2),
    );
    const code = await main(argvFor(recipeCommand(file, "diff"), ws));
    expect(code, err).toBe(1);
    expect(out).toContain("obstacles");
    expect(out).not.toContain("No drift detected.");
  });

  it("diff step: a missing baseline is a usage error, not a pass", async () => {
    await fs.rm(path.join(ws, ".baseline", "flows"), { recursive: true });
    expect(await main(argvFor(recipeCommand(file, "diff"), ws))).toBe(2);
  });

  it.skipIf(!chromiumAvailable)(
    "determinism step: two runs agree, run 1 is promoted and the run roots are gone",
    // 240s headroom: each run launches and gracefully closes a real Chromium.
    { timeout: 240_000 },
    async () => {
      const code = await main(argvFor(recipeCommand(file, "run"), ws));
      expect(code, err).toBe(0);
      expect(out).toContain("## docsxai determinism check");
      expect(out).toContain("**IDENTICAL**");
      expect(existsSync(path.join(ws, ".docsxai-verify"))).toBe(false);
      const annotations = JSON.parse(
        readFileSync(path.join(ws, "docs", "obstacles", "annotations.json"), "utf8"),
      ) as { annotations: unknown[] };
      expect(annotations.annotations).toHaveLength(1);
    },
  );
});

describe.skipIf(!viewerBuilt)("pack and pack --check against the sample repo", () => {
  beforeEach(() => {
    vi.stubEnv("DOCSX_VIEWER_BIN", viewerBin);
  });

  it("packs the committed doc pack, then finds no drift against the pack it wrote", async () => {
    expect(await main(["pack", ws, "--no-optimise"]), err).toBe(0);
    expect(existsSync(path.join(ws, ".screens", "manifest.json"))).toBe(true);
    expect(await main(["pack", ws, "--check", "--against", path.join(ws, ".screens")]), err).toBe(
      0,
    );
  }, 60_000);

  it("fails the check when the doc pack changed after the pack was written", async () => {
    expect(await main(["pack", ws, "--no-optimise"]), err).toBe(0);
    const file = path.join(ws, "docs", "obstacles", "annotations.json");
    const annotations = JSON.parse(await fs.readFile(file, "utf8")) as {
      annotations: Array<{ bounding_box: { x: number } }>;
    };
    annotations.annotations[0]!.bounding_box.x += 120;
    await fs.writeFile(file, JSON.stringify(annotations), "utf8");
    const code = await main([
      "pack",
      ws,
      "--check",
      "--against",
      path.join(ws, ".screens"),
      "--threshold",
      "0",
    ]);
    expect(code).toBe(1);
  }, 60_000);
});
