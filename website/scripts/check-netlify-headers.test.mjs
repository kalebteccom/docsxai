// Checks the Cache-Control rules in the repo's netlify.toml: /_astro/* and /showcase/* are served
// immutable for a year, and public/showcase holds only hash-named images plus manifest.json (read
// at build time by ShowcaseShot.astro). Run with `node --test` (the package's `test` script).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const toml = readFileSync(join(site, "..", "netlify.toml"), "utf8");

/** The `Cache-Control` value of the `[[headers]]` block whose `for` is `path`, or undefined. */
function cacheControl(path) {
  for (const block of toml.split("[[headers]]").slice(1)) {
    if (block.match(/^\s*for\s*=\s*"([^"]+)"/m)?.[1] !== path) continue;
    return block.match(/^\s*Cache-Control\s*=\s*"([^"]+)"/m)?.[1];
  }
  return undefined;
}

describe("netlify.toml cache headers", () => {
  const immutable = "public, max-age=31536000, immutable";
  it("serves /_astro/* immutable for a year", () => {
    assert.equal(cacheControl("/_astro/*"), immutable);
  });
  it("serves /showcase/* immutable for a year", () => {
    assert.equal(cacheControl("/showcase/*"), immutable);
  });
  it("leaves the catch-all without a Cache-Control (favicons and og.png keep the default)", () => {
    assert.equal(cacheControl("/*"), undefined);
  });
  it("public/showcase holds only hash-named PNG and WebP files plus manifest.json", () => {
    const files = readdirSync(join(site, "public", "showcase")).filter(
      (f) => f !== "manifest.json",
    );
    assert.ok(files.length > 0);
    const bad = files.filter((f) => !/\.[0-9a-f]{8}\.(png|webp)$/.test(f));
    assert.deepEqual(bad, [], "unhashed names would be cached for a year");
  });
});
