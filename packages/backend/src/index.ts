#!/usr/bin/env node
// @kalebtec/site-docs-backend — authenticated doc-pack persistence service.
//
// This module is both the library entry (re-exports the contract + `createBackendStub`) and the bin
// entry `site-docs-backend` (starts the stub). The stub is in-memory and accepts any Bearer token
// (or `SITE_DOCS_TOKEN` if set) — production replaces it with a real OAuth-2.1-protected service.

import { pathToFileURL } from "node:url";

export * from "./api.js";
export * from "./store.js";
export { createBackendStub, type BackendStubOptions } from "./server.js";

import { createBackendStub } from "./server.js";

export async function runBackendStubCli(argv: string[]): Promise<number> {
  const portArg = argv.find((a) => /^--port=/.test(a))?.split("=")[1] ?? process.env.PORT ?? "4477";
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 0) {
    process.stderr.write(`site-docs-backend: invalid port "${portArg}"\n`);
    return 2;
  }
  const stub = createBackendStub({ ...(process.env.SITE_DOCS_TOKEN ? { token: process.env.SITE_DOCS_TOKEN } : {}) });
  const url = await stub.listen(port);
  process.stdout.write(`site-docs-backend stub listening on ${url}  (in-memory; not for production)\n`);
  const stop = () => stub.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return 0; // long-lived
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackendStubCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
