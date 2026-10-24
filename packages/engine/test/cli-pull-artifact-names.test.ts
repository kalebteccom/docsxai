// `pull` asks the backend only for the artifact slots it knows. A revision that lists any other
// name is not fetched, because the name would go into the request path unescaped.

import { promises as fs } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const requested: string[] = [];
let server: http.Server;
let base = "";
let err = "";

beforeAll(async () => {
  process.env.DOCSX_TOKEN = "t";
  server = http.createServer((req, res) => {
    requested.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/revisions/head")) {
      res.end(
        JSON.stringify({
          id: "r1",
          kind: "run",
          author: "a",
          artifacts: ["flows", "../../../../v1/workspaces", "locators"],
        }),
      );
    } else if (req.url?.endsWith("/flows")) {
      res.end(JSON.stringify({ schema: "docsxai/flows@1", files: {} }));
    } else if (req.url?.endsWith("/locators")) {
      res.end(JSON.stringify({ schema: "docsxai/locators@1", yaml: "a: b\n" }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env.DOCSX_TOKEN;
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  err = "";
  requested.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("pull with an unknown artifact name in the revision", () => {
  it("fetches the known slots and skips the rest", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pull-names-"));
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        backend_url: base,
        backend_workspace_id: "w",
        backend_project_id: "p",
        created_at: "now",
      }),
      "utf8",
    );
    expect(await main(["pull", ws])).toBe(0);
    expect(requested.some((u) => u.includes(".."))).toBe(false);
    expect(requested.filter((u) => u.endsWith("/flows")).length).toBe(1);
    expect(requested.some((u) => u.endsWith("/locators"))).toBe(true);
    expect(await fs.readFile(path.join(ws, "docs", "locators.yaml"), "utf8")).toBe("a: b\n");
    expect(err).toContain("skipped");
  });
});
