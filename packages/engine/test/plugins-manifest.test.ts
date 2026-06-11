import { describe, expect, it } from "vitest";
import {
  isApiVersionCompatible,
  parsePluginManifest,
  PluginManifestError,
  satisfiesRange,
} from "../src/plugins/manifest.js";

const VALID_MANIFEST = {
  apiVersion: "1.0.0",
  namespace: "confluence",
  register: "./dist/register.js",
  kinds: ["publisher"],
};

describe("parsePluginManifest", () => {
  it("accepts a minimal manifest and applies defaults", () => {
    const m = parsePluginManifest(VALID_MANIFEST, "pkg");
    expect(m).toEqual({
      apiVersion: "1.0.0",
      namespace: "confluence",
      register: "./dist/register.js",
      kinds: ["publisher"],
      capabilities: [],
      dependsOn: [],
      trust: "local",
    });
  });

  it("rejects a package.json without a docsxai field", () => {
    expect(() => parsePluginManifest(undefined, "pkg")).toThrow(PluginManifestError);
    expect(() => parsePluginManifest(undefined, "pkg")).toThrow(/not a plugin/);
  });

  it("rejects a namespace that is not kebab-case", () => {
    for (const namespace of ["Bad_NS", "9lives", "UPPER", "has space", "dot.ted"]) {
      expect(() => parsePluginManifest({ ...VALID_MANIFEST, namespace }, "pkg")).toThrow(
        /namespace must match/,
      );
    }
  });

  it("rejects every reserved namespace", () => {
    for (const namespace of ["site-docs", "docsxai", "core", "plugins"]) {
      expect(() => parsePluginManifest({ ...VALID_MANIFEST, namespace }, "pkg")).toThrow(
        /reserved/,
      );
    }
  });

  it("requires at least one kind and rejects unknown kinds", () => {
    expect(() => parsePluginManifest({ ...VALID_MANIFEST, kinds: [] }, "pkg")).toThrow(
      /at least one extension point/,
    );
    expect(() => parsePluginManifest({ ...VALID_MANIFEST, kinds: ["webhook"] }, "pkg")).toThrow(
      PluginManifestError,
    );
  });

  it("accepts egress capabilities and rejects unknown capability prefixes", () => {
    const m = parsePluginManifest(
      { ...VALID_MANIFEST, capabilities: ["egress:*.atlassian.net", "egress:wiki.internal"] },
      "pkg",
    );
    expect(m.capabilities).toEqual(["egress:*.atlassian.net", "egress:wiki.internal"]);
    expect(() =>
      parsePluginManifest({ ...VALID_MANIFEST, capabilities: ["eval:dom"] }, "pkg"),
    ).toThrow(/egress:<host-glob>/);
  });

  it("rejects unknown manifest keys (typo safety)", () => {
    expect(() => parsePluginManifest({ ...VALID_MANIFEST, dependson: [] }, "pkg")).toThrow(
      PluginManifestError,
    );
  });

  it("rejects a non-exact-semver apiVersion", () => {
    expect(() => parsePluginManifest({ ...VALID_MANIFEST, apiVersion: "^1.0.0" }, "pkg")).toThrow(
      /exact semver/,
    );
  });

  it("parses dependsOn and trust when present", () => {
    const m = parsePluginManifest(
      {
        ...VALID_MANIFEST,
        dependsOn: [{ plugin: "docsxai-plugin-base", version: "^0.2.0" }],
        trust: "kalebtec",
      },
      "pkg",
    );
    expect(m.dependsOn).toEqual([{ plugin: "docsxai-plugin-base", version: "^0.2.0" }]);
    expect(m.trust).toBe("kalebtec");
  });
});

describe("isApiVersionCompatible", () => {
  it("accepts same major with minor ≤ runtime minor", () => {
    expect(isApiVersionCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isApiVersionCompatible("1.0.9", "1.0.0")).toBe(true);
    expect(isApiVersionCompatible("1.3.2", "1.5.0")).toBe(true);
  });

  it("rejects a newer minor, a different major, and garbage", () => {
    expect(isApiVersionCompatible("1.1.0", "1.0.0")).toBe(false);
    expect(isApiVersionCompatible("2.0.0", "1.0.0")).toBe(false);
    expect(isApiVersionCompatible("0.9.0", "1.0.0")).toBe(false);
    expect(isApiVersionCompatible("not-semver", "1.0.0")).toBe(false);
  });
});

describe("satisfiesRange", () => {
  it("exact range requires exact equality", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
  });

  it("caret allows compatible-with semantics (incl. 0.x caveats)", () => {
    expect(satisfiesRange("1.9.0", "^1.2.3")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.2", "^1.2.3")).toBe(false);
    expect(satisfiesRange("0.2.5", "^0.2.3")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("tilde pins major.minor", () => {
    expect(satisfiesRange("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.2", "~1.2.3")).toBe(false);
  });

  it("rejects unparseable versions and ranges", () => {
    expect(satisfiesRange("not-semver", "^1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", ">=1.0.0")).toBe(false);
  });
});
