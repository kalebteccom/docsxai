// `docsxai --version` and `-v`: print the package version and exit 0.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { engineVersion } from "../src/cli-version.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

let out = "";
let err = "";
beforeEach(() => {
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
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("docsxai --version", () => {
  it("reads the version from package.json", () => {
    expect(engineVersion()).toBe(pkg.version);
  });

  it.each(["--version", "-v"])("%s prints `docsxai <version>` and exits 0", async (flag) => {
    expect(await main([flag])).toBe(0);
    expect(out).toBe(`docsxai ${pkg.version}\n`);
    expect(err).toBe("");
  });

  it("is listed in the usage", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out).toContain("  docsxai --version\n");
  });
});
