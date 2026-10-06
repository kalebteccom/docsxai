// The HTTP transport refuses `cdp`, confines `baseUrl` to addresses the engine's rules allow and
// gives every browser it starts the request guard. Stdio keeps its old behaviour. Nothing here
// launches a browser: the refusals come before one starts, and the helpers take an env to read.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertBaseUrlAllowed, httpEgressGuard, rejectCdpOverHttp } from "../src/http-egress.js";
import { ToolInputError, type ToolContext } from "../src/shared.js";
import { diagnoseHaltTool } from "../src/tools/diagnose-halt.js";
import { runFlowsTool } from "../src/tools/run-flows.js";

const http: ToolContext = { workspaceRoot: "/srv/workspaces" };
const stdio: ToolContext = {};

describe("rejectCdpOverHttp", () => {
  it("refuses any cdp value over HTTP", () => {
    expect(() => rejectCdpOverHttp("http://127.0.0.1:9222", http)).toThrow(ToolInputError);
    expect(() => rejectCdpOverHttp("", http)).toThrow(/not available over the HTTP transport/);
  });

  it("lets stdio attach, and lets HTTP calls without cdp through", () => {
    expect(() => rejectCdpOverHttp("http://127.0.0.1:9222", stdio)).not.toThrow();
    expect(() => rejectCdpOverHttp(undefined, http)).not.toThrow();
  });
});

describe("assertBaseUrlAllowed", () => {
  it.each([
    "http://169.254.169.254/latest",
    "https://[fd00:ec2::254]/",
    "http://2852039166/",
    "http://168.63.129.16/",
    "http://metadata.google.internal/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "data:text/html,x",
    "not a url",
    "",
  ])("refuses %j over HTTP", async (url) => {
    await expect(assertBaseUrlAllowed(url, http, {})).rejects.toThrow(ToolInputError);
  });

  it("gives a generic message that names no address", async () => {
    const err = await assertBaseUrlAllowed("http://169.254.169.254/", http, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe("baseUrl is not allowed over the HTTP transport");
    expect(`${err.message} ${err.hint}`).not.toContain("169.254");
  });

  it("allows a public literal, and loopback unless DOCSX_EGRESS_DENY_PRIVATE is on", async () => {
    await expect(assertBaseUrlAllowed("https://8.8.8.8/", http, {})).resolves.toBeUndefined();
    await expect(assertBaseUrlAllowed("http://127.0.0.1:3000/", http, {})).resolves.toBeUndefined();
    for (const on of ["1", "true", "yes"]) {
      await expect(
        assertBaseUrlAllowed("http://127.0.0.1:3000/", http, { DOCSX_EGRESS_DENY_PRIVATE: on }),
      ).rejects.toThrow(ToolInputError);
    }
  });

  it("changes nothing on stdio or without a base URL", async () => {
    await expect(
      assertBaseUrlAllowed("http://169.254.169.254/", stdio, {}),
    ).resolves.toBeUndefined();
    await expect(assertBaseUrlAllowed(undefined, http, {})).resolves.toBeUndefined();
  });
});

describe("httpEgressGuard", () => {
  it("is on for HTTP by default, with private ranges only when asked", () => {
    expect(httpEgressGuard(http, {})).toEqual({ denyPrivate: false });
    expect(httpEgressGuard(http, { DOCSX_EGRESS_DENY_PRIVATE: "yes" })).toEqual({
      denyPrivate: true,
    });
    expect(httpEgressGuard(http, { DOCSX_EGRESS_GUARD: "tru" })).toEqual({ denyPrivate: false });
  });

  it("is off over stdio and when DOCSX_EGRESS_GUARD says off", () => {
    expect(httpEgressGuard(stdio, {})).toBeUndefined();
    for (const off of ["0", "false", "no", "NO"]) {
      expect(httpEgressGuard(http, { DOCSX_EGRESS_GUARD: off })).toBeUndefined();
    }
  });
});

describe("the tools over HTTP", () => {
  let base: string;
  let ctx: ToolContext;
  beforeAll(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "docsxai-mcp-egress-")));
    mkdirSync(path.join(base, "ws", "flows"), { recursive: true });
    writeFileSync(path.join(base, "ws", ".docsxai.json"), "{}\n");
    ctx = { workspaceRoot: base };
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("run_flows refuses cdp before it loads a flow", async () => {
    await expect(
      runFlowsTool.handler({ workspace: "ws", cdp: "http://127.0.0.1:9222" }, ctx),
    ).rejects.toThrow(/cdp is not available/);
  });

  it("run_flows refuses a metadata baseUrl before it loads a flow", async () => {
    await expect(
      runFlowsTool.handler({ workspace: "ws", baseUrl: "http://169.254.169.254/" }, ctx),
    ).rejects.toThrow(/baseUrl is not allowed/);
  });

  it("diagnose_halt refuses cdp", async () => {
    await expect(
      diagnoseHaltTool.handler(
        { workspace: "ws", flow: "tour", step: "open", cdp: "http://127.0.0.1:9222" },
        ctx,
      ),
    ).rejects.toThrow(/cdp is not available/);
  });
});
