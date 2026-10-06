// Contract: the MCP tool registry (tool names, argument shapes, the result convention) and the
// `docsxai-mcp` bin arguments.
//
// Snapshot: snapshots/mcp-tools.json, the name of every registered tool and a JSON dump of its
// input schema (argument names, optional arguments, enum values, bounds). Titles and descriptions
// are prose and are not pinned. The server is boundary-limited to calibration orchestration and
// read-only doc-pack introspection, so the test also refuses a tool named like a browser
// primitive.
//
// Update procedure (never automatic):
//   1. Run this file once with UPDATE_CONTRACT_SNAPSHOTS=1. It rewrites the snapshot and fails.
//   2. Review the snapshot diff. A removed tool, a removed or renamed argument, or a newly required
//      argument breaks hosts that call it; a new tool or a new optional argument is additive.
//   3. Update docs/public-surface.md and packages/mcp/README.md, and add a CHANGELOG entry.
//   4. Run the file again without the variable.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { describeZod, expectJsonSnapshot } from "../../../../scripts/contract-support.js";
import { SERVER_NAME, TOOL_DEFINITIONS, parseBinArgs } from "../../src/index.js";
import { fail, ok } from "../../src/shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("MCP tool registry contract", () => {
  it("matches the checked-in tool snapshot", () => {
    const tools: Record<string, unknown> = {};
    for (const def of TOOL_DEFINITIONS) tools[def.name] = describeZod(z.object(def.inputSchema));
    expectJsonSnapshot(path.join(here, "snapshots", "mcp-tools.json"), {
      serverName: SERVER_NAME,
      toolNames: TOOL_DEFINITIONS.map((d) => d.name).sort(),
      tools,
    });
  });

  it("names every tool in snake_case and exposes no browser primitive", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(def.name).not.toMatch(
        /^(click|fill|navigate|hover|press|select|screenshot|eval|snapshot|inspect|scroll)/,
      );
    }
  });

  it("uses the { ok } result convention", () => {
    expect(ok({ a: 1 })).toEqual({ a: 1, ok: true });
    expect(fail("broke")).toEqual({ ok: false, error: "broke" });
    expect(fail("broke", "try this")).toEqual({ ok: false, error: "broke", hint: "try this" });
  });
});

describe("docsxai-mcp bin arguments contract", () => {
  it("accepts --workspace <dir> and --help / -h", () => {
    expect(parseBinArgs([])).toEqual({ help: false });
    expect(parseBinArgs(["--workspace", "/tmp/ws"])).toEqual({ workspace: "/tmp/ws", help: false });
    expect(parseBinArgs(["--help"])).toEqual({ help: true });
    expect(parseBinArgs(["-h"])).toEqual({ help: true });
  });

  it("rejects an unknown argument and a --workspace with no value", () => {
    expect(() => parseBinArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseBinArgs(["--workspace"])).toThrow(/requires a <dir> value/);
  });
});
