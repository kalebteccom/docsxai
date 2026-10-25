// `site --build` from an install that cannot resolve astro (a global install: astro lives only in
// the viewer's devDependencies) names the site folder and says to run npm install there first.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewerCli } from "../src/index.js";
import { solidPng } from "./helpers/png.js";

vi.mock("node:module", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:module")>();
  return {
    ...mod,
    createRequire: (from: string | URL) => {
      const real = mod.createRequire(from);
      const wrapped = ((id: string) => real(id)) as NodeJS.Require;
      wrapped.resolve = Object.assign(
        (id: string, options?: { paths?: string[] }) => {
          if (/^astro(\/|$)/.test(id)) throw new Error(`Cannot find module '${id}'`);
          return real.resolve(id, options);
        },
        { paths: real.resolve.paths },
      );
      return wrapped;
    },
  };
});

let out = "";
let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-site-noastro-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "my ws");
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

describe("site --build without astro", () => {
  it("exits 1, names the site folder and says to npm install there first", async () => {
    const site = path.join(ws, "site");
    expect(await runViewerCli(["site", ws, "--build"])).toBe(1);
    expect(out).toContain("site: emitted");
    expect(err).toContain(`site: astro is not installed, so ${site} did not build`);
    expect(err).toContain(`next: cd '${site}' && npm install, then npm run build`);
    expect(err).not.toContain("astroBin");
    expect(err.trim().split("\n")).toHaveLength(2);
    await expect(fs.access(path.join(site, "package.json"))).resolves.toBeUndefined();
  });

  it("emits without building as before", async () => {
    expect(await runViewerCli(["site", ws])).toBe(0);
    expect(err).toBe("");
  });
});
