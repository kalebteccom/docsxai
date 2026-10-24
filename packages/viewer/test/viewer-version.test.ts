// `docsxai-viewer --version` and `-v`: print the package version and exit 0.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewerCli } from "../src/index.js";
import { viewerVersion } from "../src/viewer-version.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

let out = "";
beforeEach(() => {
  out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("docsxai-viewer --version", () => {
  it("reads the version from package.json", () => {
    expect(viewerVersion()).toBe(pkg.version);
  });

  it.each(["--version", "-v"])("%s prints `docsxai-viewer <version>` and exits 0", async (flag) => {
    expect(await runViewerCli([flag])).toBe(0);
    expect(out).toBe(`docsxai-viewer ${pkg.version}\n`);
  });
});
