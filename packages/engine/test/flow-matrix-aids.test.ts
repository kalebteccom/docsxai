// How the matrix shows up in the calibration aids and the doc-pack IO: lint, flow-tree, diagnose,
// the argument checks of `run` that fail before a browser starts, and push/pull of variant directories.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { readDocPack, writeDocPack } from "../src/doc-pack-io.js";

let out = "";
let err = "";
let tmp = "";
let ws = "";

const MATRIX_FLOW = `name: tour
locators: { btn: '#btn' }
matrix:
  locales: [en-US, es-ES]
  color_schemes: [light, dark]
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

const PLAIN_FLOW = `name: clean
locators: { btn: '#btn' }
steps:
  - id: s1
    action: hover
    target: $btn
    success: { visible: $btn }
`;

const IDS = ["en-US.light", "en-US.dark", "es-ES.light", "es-ES.dark"];

async function writeFlow(name: string, text: string): Promise<void> {
  await fs.writeFile(path.join(ws, "flows", `${name}.flow.yaml`), text, "utf8");
}

beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-matrix-aids-"));
  ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs"), { recursive: true });
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
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("lint", () => {
  it("lists the variants as R015 (info) and exits 0", async () => {
    await writeFlow("tour", MATRIX_FLOW);
    expect(await main(["lint", ws, "--format", "json"])).toBe(0);
    const issues = JSON.parse(out) as Array<{ code: string; severity: string; message: string }>;
    const r015 = issues.find((i) => i.code === "R015")!;
    expect(r015.severity).toBe("info");
    expect(r015.message).toBe(`\`matrix\` expands to 4 variants: ${IDS.join(", ")}`);
  });

  it("warns (R016) on a copy_by_locale key no variant locale can use, and exits 1", async () => {
    await writeFlow(
      "tour",
      MATRIX_FLOW.replace(
        "    target: $btn\n",
        "    target: $btn\n    annotation: { copy: x, copy_by_locale: { fr: y, es: z } }\n",
      ),
    );
    expect(await main(["lint", ws, "--format", "json"])).toBe(1);
    const issues = JSON.parse(out) as Array<{ code: string; stepId?: string; message: string }>;
    const r016 = issues.filter((i) => i.code === "R016");
    expect(r016).toHaveLength(1);
    expect(r016[0]!.stepId).toBe("s1");
    expect(r016[0]!.message).toContain("`fr`");
    expect(r016[0]!.message).not.toContain("`es`");
  });

  it("emits neither rule for a flow without a matrix", async () => {
    await writeFlow("clean", PLAIN_FLOW);
    expect(await main(["lint", ws, "--format", "json"])).toBe(0);
    expect(JSON.parse(out)).toEqual([]);
  });

  it("reports a bad only/skip as a parse error", async () => {
    await writeFlow(
      "tour",
      MATRIX_FLOW.replace(
        "    action: hover\n",
        "    action: hover\n    only: { color_scheme: [sepia] }\n",
      ),
    );
    expect(await main(["lint", ws])).toBe(1);
    expect(err).toMatch(/parse error/);
  });
});

describe("flow-tree", () => {
  it("prints the variants of a flow with a matrix", async () => {
    await writeFlow("tour", MATRIX_FLOW);
    expect(await main(["flow-tree", ws])).toBe(0);
    expect(out).toBe(
      `tour    [1 step]    {4 variants: ${IDS.join(", ")}}\n\n1 flow, max chain depth 1\n`,
    );
  });

  it("prints a flow without a matrix exactly as before", async () => {
    await writeFlow("clean", PLAIN_FLOW);
    expect(await main(["flow-tree", ws])).toBe(0);
    expect(out).toBe("clean    [1 step]\n\n1 flow, max chain depth 1\n");
  });

  it("carries the variants in the JSON tree, and only for a flow with a matrix", async () => {
    await writeFlow("tour", MATRIX_FLOW);
    await writeFlow("clean", PLAIN_FLOW);
    expect(await main(["flow-tree", ws, "--format", "json"])).toBe(0);
    const tree = JSON.parse(out) as { roots: Array<{ name: string; variants?: string[] }> };
    expect(tree.roots.find((r) => r.name === "tour")!.variants).toEqual(IDS);
    expect(Object.keys(tree.roots.find((r) => r.name === "clean")!)).toEqual([
      "name",
      "steps",
      "children",
    ]);
  });
});

describe("diagnose", () => {
  async function haltShot(variant: string): Promise<void> {
    const dir = path.join(ws, "docs", "tour", variant, "halts");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "s1.png"), "png");
  }
  const diagnose = (...extra: string[]) =>
    main(["diagnose", ws, "--flow", "tour", "--step", "s1", ...extra]);

  beforeEach(async () => {
    await writeFlow("tour", MATRIX_FLOW);
  });

  it("asks for --variant, listing the variants, when no halt shot says which one", async () => {
    expect(await diagnose()).toBe(2);
    expect(err).toContain(
      `flow "tour" has a matrix: pass --variant <id> (variants: ${IDS.join(", ")}`,
    );
    expect(err).toContain('no halt screenshot found for step "s1"');
  });

  it("picks the only variant that holds a halt shot for the step", async () => {
    await haltShot("es-ES.dark");
    expect(await diagnose()).toBe(0);
    expect(out).toContain("diagnose: flow=tour variant=es-ES.dark step=s1");
    expect(out).toContain(`variants: ${IDS.join(", ")}`);
    expect(out).toContain(path.join("docs", "tour", "es-ES.dark", "halts", "s1.png"));
  });

  it("asks for --variant when several variants halted, naming them", async () => {
    await haltShot("es-ES.dark");
    await haltShot("en-US.light");
    expect(await diagnose()).toBe(2);
    expect(err).toContain('halt screenshots for step "s1" in: en-US.light, es-ES.dark');
  });

  it("takes --variant, and rejects one the matrix does not have", async () => {
    expect(await diagnose("--variant", "en-US.dark", "--format", "json")).toBe(0);
    const report = JSON.parse(out) as { variant: string; variants: string[]; flow: string };
    expect(report.variant).toBe("en-US.dark");
    expect(report.variants).toEqual(IDS);
    out = "";
    expect(await diagnose("--variant", "fr-FR.dark")).toBe(2);
    expect(err).toContain(`no variant "fr-FR.dark" in flow "tour" (variants: ${IDS.join(", ")})`);
  });

  it("rejects --variant on a flow without a matrix, and omits the variant keys from its report", async () => {
    await writeFlow("clean", PLAIN_FLOW);
    expect(await main(["diagnose", ws, "--flow", "clean", "--step", "s1", "--variant", "x"])).toBe(
      2,
    );
    expect(err).toContain('flow "clean" has no matrix');
    out = "";
    expect(
      await main(["diagnose", ws, "--flow", "clean", "--step", "s1", "--format", "json"]),
    ).toBe(0);
    const report = JSON.parse(out) as Record<string, unknown>;
    expect(report).not.toHaveProperty("variant");
    expect(report).not.toHaveProperty("variants");
  });
});

describe("run argument checks that fail before a browser starts", () => {
  it("refuses --cdp for a flow with a matrix", async () => {
    await writeFlow("tour", MATRIX_FLOW);
    expect(await main(["run", ws, "--cdp", "http://localhost:9222"])).toBe(1);
    expect(err).toMatch(/--cdp .* cannot run the matrix of tour/);
  });

  it("rejects an unknown --variant, listing the ones that exist", async () => {
    await writeFlow("tour", MATRIX_FLOW);
    expect(await main(["run", ws, "--variant", "fr-FR.dark"])).toBe(1);
    expect(err).toContain(`no variant "fr-FR.dark" (variants: ${IDS.join(", ")})`);
  });

  it("rejects --variant when no flow has a matrix", async () => {
    await writeFlow("clean", PLAIN_FLOW);
    expect(await main(["run", ws, "--variant", "en-US.dark"])).toBe(1);
    expect(err).toContain("no flow has a matrix");
  });

  it("reports a flow whose only/skip does not match its matrix", async () => {
    await writeFlow(
      "tour",
      MATRIX_FLOW.replace("    action: hover\n", "    action: hover\n    only: { locale: [de] }\n"),
    );
    expect(await main(["run", ws])).toBe(1);
    expect(err).toMatch(/parse|do not match the matrix/);
  });
});

describe("doc-pack IO with variant directories", () => {
  async function writeOutputs(rel: string): Promise<void> {
    const dir = path.join(ws, "docs", rel);
    await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "annotations.json"),
      JSON.stringify({ schema: "docsxai/annotations@1", flow: rel.split("/")[0], annotations: [] }),
    );
    await fs.writeFile(path.join(dir, "screenshots", "s1.png"), `png:${rel}`);
  }

  it("reads flat and variant outputs into one payload, keyed by their path under docs/", async () => {
    await writeOutputs("clean");
    await writeOutputs("tour/en-US.dark");
    await writeOutputs("tour/es-ES.light");
    const pack = await readDocPack(ws);
    expect(Object.keys(pack.annotations!.files).sort()).toEqual([
      "clean/annotations.json",
      "tour/en-US.dark/annotations.json",
      "tour/es-ES.light/annotations.json",
    ]);
    expect(Object.keys(pack.screenshots!.files).sort()).toEqual([
      "clean/screenshots/s1.png",
      "tour/en-US.dark/screenshots/s1.png",
      "tour/es-ES.light/screenshots/s1.png",
    ]);
  });

  it("writes pulled variant outputs back under docs/<flow>/<variant>/", async () => {
    await writeDocPack(
      ws,
      {
        annotations: {
          schema: "docsxai/annotations-bundle@1",
          files: { "tour/en-US.dark/annotations.json": { schema: "docsxai/annotations@1" } },
        },
      },
      {},
    );
    const text = await fs.readFile(
      path.join(ws, "docs", "tour", "en-US.dark", "annotations.json"),
      "utf8",
    );
    expect(JSON.parse(text)).toEqual({ schema: "docsxai/annotations@1" });
  });
});
