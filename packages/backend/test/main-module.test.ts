import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isMainModule } from "../src/main-module.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-main-module-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isMainModule", () => {
  const real = path.join(dir, "real.js");
  const link = path.join(dir, "link.js");
  fs.writeFileSync(real, "");
  fs.symlinkSync(real, link);
  const metaUrl = pathToFileURL(fs.realpathSync(real)).href;

  it("matches the script path", () => {
    expect(isMainModule(metaUrl, real)).toBe(true);
  });

  it("matches when argv[1] is a symlink to the module, as an installed bin is", () => {
    expect(isMainModule(metaUrl, link)).toBe(true);
  });

  it("does not match another file, a missing path or no argv[1]", () => {
    const other = path.join(dir, "other.js");
    fs.writeFileSync(other, "");
    expect(isMainModule(metaUrl, other)).toBe(false);
    expect(isMainModule(metaUrl, path.join(dir, "missing.js"))).toBe(false);
    expect(isMainModule(metaUrl, undefined)).toBe(false);
  });
});
