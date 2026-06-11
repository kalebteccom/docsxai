// Dispatch + argument-contract tests for the `site-docs` CLI: the stable argv edge of each
// command (usage errors, flag validation, exit codes, output shape) — not command internals.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let out = "";
let err = "";
let tmp = "";

beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-cli-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

const CLEAN_FLOW = `name: clean
locators: { btn: '#btn' }
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

async function makeWorkspace(): Promise<string> {
  const ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs"), { recursive: true });
  await fs.writeFile(path.join(ws, "flows", "clean.flow.yaml"), CLEAN_FLOW, "utf8");
  await fs.writeFile(
    path.join(ws, ".site-docs.json"),
    JSON.stringify({ schema: "site-docs/workspace@1", created_at: "2026-01-01T00:00:00.000Z" }),
    "utf8",
  );
  return ws;
}

describe("zip dispatch", () => {
  it("zip without a workspace dir exits 2", async () => {
    expect(await main(["zip"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
  });

  it("zip on a non-existent workspace exits 1 with a ZipError message", async () => {
    expect(await main(["zip", "/definitely/not/real", "--out", path.join(tmp, "x.zip")])).toBe(1);
    expect(err).toMatch(/workspace doesn't exist/);
  });

  it("zip --out writes the archive and reports entries + size", async () => {
    const ws = await makeWorkspace();
    const outZip = path.join(tmp, "pack.zip");
    expect(await main(["zip", ws, "--out", outZip])).toBe(0);
    expect(out).toMatch(/zip: wrote .*pack\.zip \(\d+ entries, [\d.]+ KB\)/);
    const entries = Object.keys(unzipSync(new Uint8Array(await fs.readFile(outZip))));
    expect(entries).toContain("flows/clean.flow.yaml");
    expect(entries).toContain(".site-docs.json");
  });

  it("zip --include-viewer bundles .viewer/", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws, ".viewer"), { recursive: true });
    await fs.writeFile(path.join(ws, ".viewer", "index.html"), "<html></html>", "utf8");
    const without = path.join(tmp, "without.zip");
    const withViewer = path.join(tmp, "with.zip");
    expect(await main(["zip", ws, "--out", without])).toBe(0);
    expect(await main(["zip", ws, "--out", withViewer, "--include-viewer"])).toBe(0);
    const a = Object.keys(unzipSync(new Uint8Array(await fs.readFile(without))));
    const b = Object.keys(unzipSync(new Uint8Array(await fs.readFile(withViewer))));
    expect(a.some((e) => e.startsWith(".viewer/"))).toBe(false);
    expect(b).toContain(".viewer/index.html");
  });

  it("zip defaults the output to <workspace-name>.zip in the current dir", async () => {
    const ws = await makeWorkspace();
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      expect(await main(["zip", ws])).toBe(0);
      await expect(fs.access(path.join(tmp, "ws.zip"))).resolves.toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("render dispatch", () => {
  async function makeFakeViewerScript(body: string): Promise<string> {
    const script = path.join(tmp, "fake-viewer.js");
    await fs.writeFile(script, body, "utf8");
    return script;
  }

  it("runs the bin named by $SITE_DOCS_VIEWER_BIN with build <docsDir> <outDir>", async () => {
    const ws = await makeWorkspace();
    const argvFile = path.join(tmp, "argv.json");
    const script = await makeFakeViewerScript(
      `require("node:fs").writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    vi.stubEnv("SITE_DOCS_VIEWER_BIN", script);
    expect(await main(["render", ws])).toBe(0);
    expect(out).toMatch(/render: open .*index\.html/);
    const argv = JSON.parse(await fs.readFile(argvFile, "utf8")) as string[];
    expect(argv).toEqual(["build", path.join(ws, "docs"), path.join(ws, ".viewer")]);
  });

  it("propagates the viewer's non-zero exit code", async () => {
    const ws = await makeWorkspace();
    const script = await makeFakeViewerScript("process.exit(3);\n");
    vi.stubEnv("SITE_DOCS_VIEWER_BIN", script);
    expect(await main(["render", ws])).toBe(3);
    expect(out).not.toMatch(/render: open/);
  });

  it("fails with an error listing all three resolution attempts when no viewer is found", async () => {
    const ws = await makeWorkspace();
    vi.stubEnv("SITE_DOCS_VIEWER_BIN", path.join(tmp, "no-such-viewer.js"));
    vi.stubEnv("PATH", "");
    expect(await main(["render", ws])).toBe(1);
    expect(err).toMatch(/could not be launched/);
    expect(err).toMatch(/1\. \$SITE_DOCS_VIEWER_BIN → .*no-such-viewer\.js \(no such file\)/);
    expect(err).toMatch(/2\. @kalebtec\/docsxai-viewer \(installed package\)/);
    expect(err).toMatch(/3\. `docsxai-viewer` on PATH — not found/);
  });
});

describe("push / pull / login argument contracts", () => {
  it("push without a workspace dir exits 2", async () => {
    expect(await main(["push"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
  });

  it("push on a workspace with no backend_url exits 2", async () => {
    const ws = await makeWorkspace();
    expect(await main(["push", ws])).toBe(2);
    expect(err).toMatch(/no backend_url/);
  });

  it("push validates --kind before touching the backend", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(
      path.join(ws, ".site-docs.json"),
      JSON.stringify({
        schema: "site-docs/workspace@1",
        backend_url: "http://127.0.0.1:1",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    expect(await main(["push", ws, "--kind", "bogus"])).toBe(2);
    expect(err).toMatch(/--kind must be calibrate \| run \| edit/);
  });

  it("pull without a workspace dir exits 2", async () => {
    expect(await main(["pull"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
  });

  it("pull on a workspace not bound to a backend exits 2", async () => {
    const ws = await makeWorkspace();
    expect(await main(["pull", ws])).toBe(2);
    expect(err).toMatch(/isn't bound to a backend/);
  });

  it("login without --backend-url exits 2", async () => {
    expect(await main(["login"])).toBe(2);
    expect(err).toMatch(/--backend-url <url> required/);
  });

  it("login without SITE_DOCS_TOKEN exits 2", async () => {
    const saved = process.env.SITE_DOCS_TOKEN;
    delete process.env.SITE_DOCS_TOKEN;
    try {
      expect(await main(["login", "--backend-url", "http://127.0.0.1:1"])).toBe(2);
      expect(err).toMatch(/SITE_DOCS_TOKEN env var not set/);
    } finally {
      if (saved !== undefined) process.env.SITE_DOCS_TOKEN = saved;
    }
  });
});

describe("lint / flow-tree / style dispatch smoke", () => {
  it("lint without a workspace dir exits 2; bad --format exits 2", async () => {
    expect(await main(["lint"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["lint", "/some/ws", "--format", "xml"])).toBe(2);
    expect(err).toMatch(/--format must be/);
  });

  it("lint on a clean workspace exits 0; --format json emits a JSON array", async () => {
    const ws = await makeWorkspace();
    expect(await main(["lint", ws])).toBe(0);
    expect(out).toMatch(/no issues/);
    out = "";
    expect(await main(["lint", ws, "--format", "json"])).toBe(0);
    expect(JSON.parse(out)).toEqual([]);
  });

  it("flow-tree without a workspace dir exits 2; bad --format exits 2", async () => {
    expect(await main(["flow-tree"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["flow-tree", "/some/ws", "--format", "xml"])).toBe(2);
    expect(err).toMatch(/--format must be/);
  });

  it("flow-tree on a clean workspace exits 0 and lists the flow", async () => {
    const ws = await makeWorkspace();
    expect(await main(["flow-tree", ws])).toBe(0);
    expect(out).toContain("clean");
    out = "";
    expect(await main(["flow-tree", ws, "--format", "json"])).toBe(0);
    const tree = JSON.parse(out) as { orphans: unknown[]; issues: unknown[] };
    expect(tree.orphans).toEqual([]);
    expect(tree.issues).toEqual([]);
  });

  it("style without a workspace dir exits 2; bad --format exits 2", async () => {
    expect(await main(["style"])).toBe(2);
    expect(err).toMatch(/missing <workspace-dir>/);
    err = "";
    expect(await main(["style", "/some/ws", "--format", "xml"])).toBe(2);
    expect(err).toMatch(/--format must be/);
  });

  it("style initialises docs/style.yaml on first run, validates on the second", async () => {
    const ws = await makeWorkspace();
    expect(await main(["style", ws])).toBe(0);
    expect(out).toMatch(/style: created/);
    await expect(fs.access(path.join(ws, "docs", "style.yaml"))).resolves.toBeUndefined();
    out = "";
    expect(await main(["style", ws])).toBe(0);
    expect(out).toMatch(/style: validated/);
  });
});
