import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  formatJargonHitsText,
  initStyleIfAbsent,
  JARGON_PATTERNS,
  loadStyle,
  scanTextForJargon,
  scanWorkspaceForJargon,
  StyleError,
  stylePathsFor,
  writeStyle,
} from "../src/style.js";

describe("stylePathsFor", () => {
  it("derives yaml + json paths under <workspace>/docs/", () => {
    const p = stylePathsFor("/tmp/ws");
    expect(p.yamlPath).toMatch(/\/tmp\/ws\/docs\/style\.yaml$/);
    expect(p.jsonPath).toMatch(/\/tmp\/ws\/docs\/style\.json$/);
  });
});

describe("style — load/write/init", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-style-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("loadStyle returns null when style.yaml doesn't exist", async () => {
    expect(await loadStyle(tmp)).toBeNull();
  });

  it("writeStyle persists YAML + derived JSON; loadStyle round-trips", async () => {
    await writeStyle(tmp, DEFAULT_STYLE);
    const reloaded = await loadStyle(tmp);
    expect(reloaded).toEqual(DEFAULT_STYLE);
    const jsonText = await fs.readFile(path.join(tmp, "docs", "style.json"), "utf8");
    expect(JSON.parse(jsonText)).toEqual(DEFAULT_STYLE);
  });

  it("initStyleIfAbsent writes DEFAULT_STYLE on first call; no-op on second", async () => {
    const r1 = await initStyleIfAbsent(tmp);
    expect(r1.created).toBe(true);
    const r2 = await initStyleIfAbsent(tmp);
    expect(r2.created).toBe(false);
  });

  it("loadStyle throws StyleError on invalid YAML", async () => {
    const { yamlPath } = stylePathsFor(tmp);
    await fs.mkdir(path.dirname(yamlPath), { recursive: true });
    await fs.writeFile(yamlPath, "schema: [unclosed", "utf8");
    await expect(loadStyle(tmp)).rejects.toThrow(StyleError);
  });

  it("loadStyle throws StyleError on schema mismatch", async () => {
    const { yamlPath } = stylePathsFor(tmp);
    await fs.mkdir(path.dirname(yamlPath), { recursive: true });
    await fs.writeFile(yamlPath, "schema: wrong-schema\n", "utf8");
    await expect(loadStyle(tmp)).rejects.toThrow(/schema validation failed/);
  });
});

describe("scanTextForJargon", () => {
  it("flags VERIFY/EXPECT/ASSERT directives when the category is in pruning_rules", () => {
    const hits = scanTextForJargon("VERIFY the result is 200.\nClick Save.", "f/s.md", [
      "VERIFY/EXPECT/ASSERT directives",
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      file: "f/s.md",
      line: 1,
      category: "VERIFY/EXPECT/ASSERT directives",
      snippet: "VERIFY",
    });
  });

  it("flags WAIT directives", () => {
    expect(scanTextForJargon("WAIT FOR 5s, then click.", "x.md", ["WAIT directives"])).toHaveLength(
      1,
    );
  });

  it("flags internal locator-name leaks", () => {
    const hits = scanTextForJargon("Click the element with data-testid='save'.", "x.md", [
      "internal locator names",
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toBe("data-testid");
  });

  it("flags network-verification blocks", () => {
    const hits = scanTextForJargon("Then POST /api/v1/save and expect status: 200.", "x.md", [
      "network-verification blocks",
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("returns nothing when the category isn't requested", () => {
    expect(scanTextForJargon("VERIFY the result.", "x.md", ["WAIT directives"])).toEqual([]);
  });

  it("attributes the right line number", () => {
    const text = "line one\nline two with VERIFY in it\nline three";
    const hits = scanTextForJargon(text, "x.md", ["VERIFY/EXPECT/ASSERT directives"]);
    expect(hits[0]!.line).toBe(2);
  });
});

describe("scanWorkspaceForJargon", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-style-scan-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("scans every docs/<flow>/<step>.md against the style's pruning_rules", async () => {
    await fs.mkdir(path.join(tmp, "docs", "f1"), { recursive: true });
    await fs.mkdir(path.join(tmp, "docs", "f2"), { recursive: true });
    await fs.writeFile(path.join(tmp, "docs", "f1", "open.md"), "Click the button.\n", "utf8");
    await fs.writeFile(path.join(tmp, "docs", "f1", "verify.md"), "VERIFY the result.\n", "utf8");
    await fs.writeFile(path.join(tmp, "docs", "f2", "close.md"), "WAIT for the panel.\n", "utf8");
    const hits = await scanWorkspaceForJargon(tmp, DEFAULT_STYLE);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.file).sort()).toEqual([
      path.join("docs", "f1", "verify.md"),
      path.join("docs", "f2", "close.md"),
    ]);
  });

  it("ignores non-.md files and non-directory entries", async () => {
    await fs.mkdir(path.join(tmp, "docs", "f1"), { recursive: true });
    await fs.writeFile(path.join(tmp, "docs", "f1", "screenshot.png"), "fake", "utf8");
    await fs.writeFile(
      path.join(tmp, "docs", "f1", "annotations.json"),
      '{"schema":"docsxai/annotations@1","flow":"f1","annotations":[]}',
      "utf8",
    );
    expect(await scanWorkspaceForJargon(tmp, DEFAULT_STYLE)).toEqual([]);
  });

  it("returns no hits when pruning_rules is empty", async () => {
    await fs.mkdir(path.join(tmp, "docs", "f1"), { recursive: true });
    await fs.writeFile(path.join(tmp, "docs", "f1", "x.md"), "VERIFY all the things.", "utf8");
    expect(
      await scanWorkspaceForJargon(tmp, { schema: "docsxai/style@1", pruning_rules: [] }),
    ).toEqual([]);
  });
});

describe("formatJargonHitsText", () => {
  it("renders a sorted-ish list with line + category + snippet", () => {
    const out = formatJargonHitsText([
      { file: "docs/f/s.md", line: 3, category: "WAIT directives", snippet: "WAIT" },
    ]);
    expect(out).toContain("1 jargon leak");
    expect(out).toContain("docs/f/s.md:3");
    expect(out).toContain("[WAIT directives]");
  });

  it("'no jargon leaks' on empty input", () => {
    expect(formatJargonHitsText([])).toMatch(/no jargon leaks/);
  });
});

describe("JARGON_PATTERNS catalogue", () => {
  it("DEFAULT_STYLE's pruning_rules all have matching patterns in the catalogue", () => {
    for (const category of DEFAULT_STYLE.pruning_rules ?? []) {
      expect(JARGON_PATTERNS[category]).toBeDefined();
    }
  });
});
