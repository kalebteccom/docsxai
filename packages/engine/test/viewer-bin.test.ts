import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatViewerBinFailure,
  resolveViewerBin,
  VIEWER_BIN_ENV,
  VIEWER_BIN_NAME,
  VIEWER_PACKAGE,
} from "../src/viewer-bin.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-viewer-bin-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A dir with no resolvable viewer package — forces the require.resolve step to fail. */
function noPackageHere(): string[] {
  return [tmp];
}

async function makeFakeViewerPackage(opts: {
  bin?: string | Record<string, string>;
  writeBinFile?: boolean;
}): Promise<string> {
  const pkgDir = path.join(tmp, "node_modules", ...VIEWER_PACKAGE.split("/"));
  await fs.mkdir(path.join(pkgDir, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: VIEWER_PACKAGE, version: "0.0.0", bin: opts.bin }),
    "utf8",
  );
  if (opts.writeBinFile !== false) {
    await fs.writeFile(path.join(pkgDir, "dist", "index.js"), "process.exit(0);\n", "utf8");
  }
  return path.join(pkgDir, "dist", "index.js");
}

describe("resolveViewerBin", () => {
  it("prefers $SITE_DOCS_VIEWER_BIN, running a .js script with the current Node", async () => {
    const script = path.join(tmp, "viewer-bin.js");
    await fs.writeFile(script, "process.exit(0);\n", "utf8");
    const r = await resolveViewerBin({
      env: { [VIEWER_BIN_ENV]: script },
      resolveFrom: noPackageHere(),
    });
    expect(r).toMatchObject({ command: process.execPath, prefixArgs: [script], source: "env" });
  });

  it("runs a non-.js $SITE_DOCS_VIEWER_BIN target directly as the command", async () => {
    const exe = path.join(tmp, "viewer-shim");
    await fs.writeFile(exe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const r = await resolveViewerBin({
      env: { [VIEWER_BIN_ENV]: exe },
      resolveFrom: noPackageHere(),
    });
    expect(r).toMatchObject({ command: exe, prefixArgs: [], source: "env" });
  });

  it("resolves the installed viewer package's bin (object form) and runs it with Node", async () => {
    const binJs = await makeFakeViewerPackage({ bin: { [VIEWER_BIN_NAME]: "./dist/index.js" } });
    const r = await resolveViewerBin({ env: {}, resolveFrom: [tmp] });
    expect(r).toMatchObject({ command: process.execPath, prefixArgs: [binJs], source: "package" });
    expect(r.attempts[0]).toContain("not set");
  });

  it("resolves a string-form bin field too", async () => {
    const binJs = await makeFakeViewerPackage({ bin: "./dist/index.js" });
    const r = await resolveViewerBin({ env: {}, resolveFrom: [tmp] });
    expect(r).toMatchObject({ command: process.execPath, prefixArgs: [binJs], source: "package" });
  });

  it("falls past the package when its bin file is missing (unbuilt install)", async () => {
    await makeFakeViewerPackage({
      bin: { [VIEWER_BIN_NAME]: "./dist/index.js" },
      writeBinFile: false,
    });
    const r = await resolveViewerBin({ env: {}, resolveFrom: [tmp] });
    expect(r).toMatchObject({ command: VIEWER_BIN_NAME, source: "path" });
    expect(r.attempts.some((a) => a.includes("bin file missing"))).toBe(true);
  });

  it("falls past a $SITE_DOCS_VIEWER_BIN that points at a missing file", async () => {
    const ghost = path.join(tmp, "no-such-bin.js");
    const binJs = await makeFakeViewerPackage({ bin: { [VIEWER_BIN_NAME]: "./dist/index.js" } });
    const r = await resolveViewerBin({ env: { [VIEWER_BIN_ENV]: ghost }, resolveFrom: [tmp] });
    expect(r).toMatchObject({ command: process.execPath, prefixArgs: [binJs], source: "package" });
    expect(r.attempts[0]).toContain("no such file");
  });

  it("falls back to PATH when nothing else resolves, recording all attempts", async () => {
    const r = await resolveViewerBin({ env: {}, resolveFrom: noPackageHere() });
    expect(r).toMatchObject({ command: VIEWER_BIN_NAME, prefixArgs: [], source: "path" });
    expect(r.attempts).toHaveLength(3);
  });

  it("formatViewerBinFailure lists every attempt and an install hint", async () => {
    const r = await resolveViewerBin({ env: {}, resolveFrom: noPackageHere() });
    const msg = formatViewerBinFailure(r);
    expect(msg).toContain(`1. $${VIEWER_BIN_ENV}`);
    expect(msg).toContain(`2. ${VIEWER_PACKAGE} (installed package)`);
    expect(msg).toContain("3. `docsxai-viewer` on PATH — not found");
    expect(msg).toContain(`Install ${VIEWER_PACKAGE}`);
  });
});
