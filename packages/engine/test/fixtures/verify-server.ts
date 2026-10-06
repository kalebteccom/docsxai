// Loopback server for the verify-determinism keystone. It serves test/fixtures/toy-site/verify.html
// with its {{STAMP}} placeholder filled in: a constant for the deterministic page, a counter that
// moves on every request for the injected one, so two runs of the same flow never see the same page.

import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, "toy-site", "verify.html");

export type VerifyPageMode = "stable" | "flaky";

export interface VerifyPageServer {
  baseURL: string;
  /** Requests answered for verify.html so far. */
  requests(): number;
  close(): Promise<void>;
}

export async function serveVerifyPage(mode: VerifyPageMode): Promise<VerifyPageServer> {
  const template = await fs.readFile(page, "utf8");
  let served = 0;
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url !== "/verify.html") {
      res.writeHead(404).end();
      return;
    }
    served++;
    // One digit wide either way, so the stamp's box is the same and only its pixels move.
    const stamp = mode === "flaky" ? String(served % 10) : "0";
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(template.replace("{{STAMP}}", stamp));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests: () => served,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
