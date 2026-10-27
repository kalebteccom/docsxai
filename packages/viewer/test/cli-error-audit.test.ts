// Viewer CLI wording found by an audit of every user-reachable message: an annotations.json that
// is damaged named no file or said `undefined`, a mistyped flow leaked an internal function name,
// an invalid `--accent` exited 1, and an unknown command or a pack usage error dumped help text.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { astroFailureText } from "../src/cli-failure.js";
import { runViewerCli } from "../src/index.js";
import { normalizeAccent } from "../src/starlight-emit.js";
import { solidPng } from "./helpers/png.js";

let out = "";
let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-audit-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "docs", "f1", "screenshots"), { recursive: true });
  await fs.writeFile(path.join(ws, "docs", "f1", "screenshots", "open.png"), solidPng(320, 200));
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify({ schema: "docsxai/workspace@1", app_url: "http://127.0.0.1:1" }),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const annotations = (body: string) =>
  fs.writeFile(path.join(ws, "docs", "f1", "annotations.json"), body);
const file = () => path.join(ws, "docs", "f1", "annotations.json");

describe("burn over a damaged annotations.json", () => {
  it("names the file when it is not JSON", async () => {
    await annotations("{{");
    expect(await runViewerCli(["burn", ws])).toBe(1);
    expect(err).toContain(`burn: ${file()}: not valid JSON: `);
    expect(err).toContain(`next: fix ${file()}, then docsxai burn ${ws}`);
  });

  it("names the file when it has no annotations list", async () => {
    await annotations('{"annotations":"x"}');
    expect(await runViewerCli(["burn", ws])).toBe(1);
    expect(err).toContain(`burn: ${file()}: expected an "annotations" list`);
  });

  it("names the record that has no step, and never prints 'undefined'", async () => {
    await annotations('{"annotations":[{"copy":"x"}]}');
    expect(await runViewerCli(["burn", ws])).toBe(1);
    expect(err).toContain(`burn: ${file()}: annotations[0] has no "step"`);
    expect(err).not.toContain("undefined");
  });
});

describe("burn --flow with a flow that has no annotations.json", () => {
  it("names the flow, the docs directory and the flows that exist, without the internal function name", async () => {
    await annotations('{"annotations":[]}');
    expect(await runViewerCli(["burn", ws, "--flow", "zz"])).toBe(1);
    expect(err).toContain(
      `burn: no flow "zz" with annotations.json under ${path.join(ws, "docs")}`,
    );
    expect(err).toContain("(flows: f1)");
    expect(err).toContain(`next: docsxai run ${ws}, or pass --flow <name> with one of the flows`);
    expect(err).not.toContain("burnFlow");
  });
});

describe("site", () => {
  it("an invalid --accent is a usage error with the value and the usage line", async () => {
    await annotations('{"annotations":[]}');
    expect(await runViewerCli(["site", ws, "--accent", "zz"])).toBe(2);
    expect(err).toContain('site: --accent must be a hex colour like #2563eb (got "zz")');
    expect(err).toContain("usage: docsxai-viewer site ");
    expect(err).not.toContain("\u2014");
  });

  it("the accent parser's own error has no em dash", () => {
    expect(() => normalizeAccent("zz")).toThrow('invalid accent color "zz": expected a hex color');
  });

  it("an annotations.json it cannot read is a warning, not silence", async () => {
    await annotations("{{");
    expect(await runViewerCli(["site", ws, "--out", path.join(tmp, "site")])).toBe(0);
    expect(err).toContain('site: warning: flow "f1": annotations.json could not be parsed');
  });
});

describe("the viewer bin", () => {
  it("an unknown command names itself on stderr, then prints the help on stdout with exit 2", async () => {
    expect(await runViewerCli(["bogus"])).toBe(2);
    expect(err).toBe('docsxai-viewer: unknown command "bogus"\n');
    expect(out).toContain("Usage:");
  });

  it.each([["--help"], ["-h"], ["help"]])("%s prints the help and exits 0", async (flag) => {
    expect(await runViewerCli([flag])).toBe(0);
    expect(out).toContain("Usage:");
    expect(err).toBe("");
  });
});

describe("pack usage errors", () => {
  it.each([
    [["pack", ws, "--out"], "pack: --out needs a value"],
    [["pack", ws, "--check"], "pack --check: --against <pack-dir> is required"],
    [
      ["pack", ws, "--check", "--against", ws, "--threshold", "x"],
      "pack --check: --threshold needs",
    ],
  ])("%j shows the message and its own usage line, not the whole help", async (argv, message) => {
    expect(await runViewerCli(argv)).toBe(2);
    expect(err).toContain(message);
    expect(err).toContain("usage: docsxai-viewer pack <workspace-or-raw-dir>");
    expect(err).not.toContain("Usage:");
    expect(err).not.toContain("--public-prefix  URL path");
    expect(err.split("\n").length).toBeLessThan(8);
  });
});

describe("pack input errors", () => {
  it("a path that does not exist says so", async () => {
    expect(await runViewerCli(["pack", path.join(tmp, "nope")])).toBe(1);
    expect(err).toContain(`pack: ${path.join(tmp, "nope")} does not exist`);
    expect(err).toContain("next: ");
  });

  it("a path that is a file says so", async () => {
    expect(await runViewerCli(["pack", path.join(ws, ".docsxai.json")])).toBe(1);
    expect(err).toContain(`pack: ${path.join(ws, ".docsxai.json")} is a file, not a directory`);
  });

  it("a raw capture step without step.json says what the file is for", async () => {
    const raw = path.join(tmp, "raw");
    await fs.mkdir(path.join(raw, "flow-a", "step-1"), { recursive: true });
    await fs.writeFile(path.join(raw, "flow-a", "flow.json"), "{}");
    expect(await runViewerCli(["pack", raw, "--from-raw", "--out", path.join(tmp, "o")])).toBe(1);
    expect(err).toContain(
      `pack: ${path.join(raw, "flow-a", "step-1", "step.json")} does not exist`,
    );
    expect(err).toContain("raw capture");
    expect(err).toContain("next: ");
  });

  it("a pack.json that is not JSON is named", async () => {
    await fs.writeFile(path.join(ws, "pack.json"), "{{");
    expect(await runViewerCli(["pack", ws])).toBe(1);
    expect(err).toContain("pack: invalid JSON in pack.json");
  });
});

describe("a failed astro build", () => {
  it("is the first lines of astro's output, with no stack trace and no absolute path under node_modules", async () => {
    const raw = [
      "11:56:24 [ERROR] [vite] x Build failed in 806ms",
      "No cached compile metadata found for /home/me/proj/node_modules/.pnpm/astro@7/node_modules/astro/x.astro",
      "  Stack trace:",
      "    at LoadPluginContextImpl.handler (file:///home/me/proj/node_modules/.pnpm/astro/index.js:109:19)",
      "    at plugin (file:///home/me/proj/node_modules/.pnpm/rolldown/x.mjs:1762:30)",
      "",
    ].join("\n");
    const text = astroFailureText(raw, "/home/me/proj/site");
    expect(text).toContain("[ERROR] [vite] x Build failed in 806ms");
    const [body, next] = text.split("next: ");
    expect(body).not.toContain("Stack trace");
    expect(body).not.toContain("    at ");
    expect(body).not.toContain("/home/me");
    expect(next).toContain("npx astro build");
  });
});
