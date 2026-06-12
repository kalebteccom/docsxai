#!/usr/bin/env node
// @docsxai/backend — authenticated doc-pack persistence service.
//
// This module is both the library entry (re-exports the contract + `createBackendStub`) and the bin
// entry `docsxai-backend` (starts the server). Storage is in-memory by default; `--data-dir=<dir>`
// (or DOCSX_DATA_DIR) persists to disk via `FsStore`. Auth accepts the pre-issued bearer token
// (DOCSX_TOKEN) and OAuth-2.1-issued access tokens (authorization-code + PKCE; see /v1/oauth/*).

import { pathToFileURL } from "node:url";

export * from "./api.js";
export * from "./store.js";
export * from "./fs-store.js";
export * from "./oauth.js";
export * from "./webhook.js";
export * from "./runner.js";
export * from "./strategy.js";
export { createBackendStub, type BackendStubOptions } from "./server.js";

import { createBackendStub } from "./server.js";

export async function runBackendStubCli(argv: string[]): Promise<number> {
  const portArg = argv.find((a) => /^--port=/.test(a))?.split("=")[1] ?? process.env.PORT ?? "4477";
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 0) {
    process.stderr.write(`docsxai-backend: invalid port "${portArg}"\n`);
    return 2;
  }
  const dataDir =
    argv
      .find((a) => /^--data-dir=/.test(a))
      ?.split("=")
      .slice(1)
      .join("=") ?? process.env.DOCSX_DATA_DIR;
  const stub = createBackendStub({
    ...(process.env.DOCSX_TOKEN ? { token: process.env.DOCSX_TOKEN } : {}),
    ...(dataDir ? { dataDir } : {}),
  });
  const url = await stub.listen(port);
  process.stdout.write(
    `docsxai-backend listening on ${url}  (${dataDir ? `data dir: ${dataDir}` : "in-memory; not for production"})\n`,
  );
  const stop = () => {
    void stub.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0; // long-lived
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runBackendStubCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
