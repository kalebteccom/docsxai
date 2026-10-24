// A flow whose `name:` differs from its file name still runs, but `extends:`, `--flow` and the
// docs/<name>/ directory all use the name, so `lint` warns about the mismatch (R017).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { parseFlowFile } from "../src/flow-file.js";
import { lintFlow } from "../src/flow-lint.js";

const FLOW = (name: string): string => `name: ${name}
steps:
  - id: s1
    action: navigate
    value: /
    success: { url_matches: "/" }
`;

describe("lintFlow — R017 (flow name differs from file name)", () => {
  it("warns when the name and the file name differ", async () => {
    const issues = await lintFlow(parseFlowFile(FLOW("checkout")), {
      fileName: "payment.flow.yaml",
    });
    expect(issues.find((i) => i.code === "R017")).toMatchObject({
      severity: "warning",
      flow: "checkout",
    });
  });

  it("is quiet when they match", async () => {
    const issues = await lintFlow(parseFlowFile(FLOW("checkout")), {
      fileName: "checkout.flow.yaml",
    });
    expect(issues.find((i) => i.code === "R017")).toBeUndefined();
  });

  it("is quiet when the file name is not known", async () => {
    const issues = await lintFlow(parseFlowFile(FLOW("checkout")));
    expect(issues.find((i) => i.code === "R017")).toBeUndefined();
  });
});

describe("docsxai lint — flow name against file name", () => {
  let ws: string;
  let out = "";
  beforeEach(async () => {
    out = "";
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-lint-name-"));
    await fs.mkdir(path.join(ws, "flows"));
    await fs.writeFile(path.join(ws, "flows", "payment.flow.yaml"), FLOW("checkout"));
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("prints the warning (warnings exit 1, like every other lint warning)", async () => {
    expect(await main(["lint", ws])).toBe(1);
    expect(out).toContain("R017");
    expect(out).toContain("payment.flow.yaml");
  });
});
