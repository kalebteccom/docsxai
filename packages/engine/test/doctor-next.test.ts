// `docsxai doctor`: the closing `next:` follows the workspace's state, the version row leads the
// text, `--format json` prints a stable shape, and default output names no environment variable.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { engineVersion } from "../src/cli-version.js";
import {
  DOCTOR_JSON_SCHEMA,
  doctorNextStep,
  doctorReport,
  formatDoctorChecks,
} from "../src/doctor.js";

const FLOW = `name: hello
locators: { heading: h1 }
steps:
  - id: open
    action: navigate
    value: /
    success: { visible: $heading }
`;

let tmp = "";
let out = "";
let err = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-next-"));
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
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.mkdir(path.join(ws, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify({ schema: "docsxai/workspace@1", created_at: "2026-01-01T00:00:00.000Z" }),
    "utf8",
  );
  return ws;
}

describe("doctorNextStep", () => {
  it("points at init --example outside a workspace", async () => {
    expect(await doctorNextStep(undefined, tmp)).toBe("docsxai init <workspace-dir> --example");
    const missing = path.join(tmp, "new ws");
    expect(await doctorNextStep(missing, missing)).toBe(`docsxai init '${missing}' --example`);
  });

  it("points at calibrate when flows/ is empty", async () => {
    const ws = await workspace();
    expect(await doctorNextStep(ws, ws)).toBe(`docsxai calibrate ${ws} --from <flow.yaml>`);
  });

  it("points at run when there are flows and nothing captured", async () => {
    const ws = await workspace();
    await fs.writeFile(path.join(ws, "flows", "hello.flow.yaml"), FLOW, "utf8");
    expect(await doctorNextStep(ws, ws)).toBe(`docsxai run ${ws}`);
  });

  it("points at render --open once a flow or a matrix variant has annotations", async () => {
    const ws = await workspace();
    await fs.writeFile(path.join(ws, "flows", "hello.flow.yaml"), FLOW, "utf8");
    await fs.mkdir(path.join(ws, "docs", "hello", "en.light.1280"), { recursive: true });
    await fs.writeFile(path.join(ws, "docs", "hello", "en.light.1280", "annotations.json"), "{}");
    expect(await doctorNextStep(ws, ws)).toBe(`docsxai render ${ws} --open`);
  });

  it("uses . when doctor runs in the workspace without an argument", async () => {
    const ws = await workspace();
    expect(await doctorNextStep(undefined, ws)).toBe("docsxai calibrate . --from <flow.yaml>");
  });
});

describe("formatDoctorChecks options", () => {
  it("leads with the version row and leaves it out of the counts", () => {
    const text = formatDoctorChecks([{ name: "node", ok: true, detail: "v26.0.0" }], {
      version: "1.2.3",
      next: "docsxai run .",
    });
    expect(text).toBe(
      [
        "ok: version: docsxai 1.2.3",
        "ok: node: v26.0.0",
        "ok: doctor: all checks passed (1 checks, 0 informational) next: docsxai run .",
        "",
      ].join("\n"),
    );
  });

  it("drops next: from the passing summary when none is given", () => {
    expect(formatDoctorChecks([{ name: "node", ok: true, detail: "v26.0.0" }])).toBe(
      "ok: node: v26.0.0\nok: doctor: all checks passed (1 checks, 0 informational)\n",
    );
  });
});

describe("doctorReport", () => {
  it("has stable keys in a fixed order", () => {
    const report = doctorReport(
      [
        { name: "node", ok: true, detail: "v26.0.0" },
        { name: "flows", ok: true, info: true, detail: "flows/ is empty" },
        { name: "chromium", ok: false, detail: "missing", fix: "install it" },
      ],
      { version: "1.2.3", next: "docsxai run ." },
    );
    expect(report).toEqual({
      schema: DOCTOR_JSON_SCHEMA,
      version: "1.2.3",
      ok: false,
      checks: [
        { name: "node", ok: true, info: false, detail: "v26.0.0", next: null },
        { name: "flows", ok: true, info: true, detail: "flows/ is empty", next: null },
        { name: "chromium", ok: false, info: false, detail: "missing", next: "install it" },
      ],
      next: "fix the fail lines above, then run docsxai doctor again",
    });
    expect(Object.keys(report)).toEqual(["schema", "version", "ok", "checks", "next"]);
    expect(DOCTOR_JSON_SCHEMA).toBe("docsxai/doctor@1");
  });
});

describe("docsxai doctor end to end", () => {
  it("prints the version first and no environment variable name on a fresh install", async () => {
    vi.stubEnv("DOCSX_VIEWER_BIN", path.join(tmp, "viewer.mjs"));
    await fs.writeFile(path.join(tmp, "viewer.mjs"), "export {};\n", "utf8");
    const ws = await workspace();
    await main(["doctor", ws, "--offline"]);
    vi.unstubAllEnvs();
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(`ok: version: docsxai ${engineVersion()}`);
    expect(out).not.toContain("DOCSX_");
    expect(out).not.toMatch(/layer \d/);
    // The host's Node may be below the floor, so the closing line is either verdict.
    expect(lines.at(-1)).toMatch(
      /^(ok: doctor: .* next: docsxai calibrate .* --from <flow\.yaml>|fail: doctor: .*)$/,
    );
  });

  it("--format json prints one JSON document with the same verdict", async () => {
    const ws = await workspace();
    const code = await main(["doctor", ws, "--offline", "--format", "json"]);
    const report = JSON.parse(out) as {
      schema: string;
      version: string;
      ok: boolean;
      checks: Array<{ name: string }>;
    };
    expect(report.schema).toBe("docsxai/doctor@1");
    expect(report.version).toBe(engineVersion());
    expect(code).toBe(report.ok ? 0 : 1);
    expect(report.checks.map((c) => c.name)).toContain("workspace");
    expect(report.checks.map((c) => c.name)).not.toContain("version");
    expect(out.endsWith("}\n")).toBe(true);
  });

  it("rejects an unknown --format with exit 2", async () => {
    expect(await main(["doctor", "--format", "yaml"])).toBe(2);
    expect(err).toMatch(/--format must be text or json/);
  });
});
