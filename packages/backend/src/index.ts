#!/usr/bin/env node
// @docsxai/backend — authenticated doc-pack persistence service.
//
// This module is both the library entry (re-exports the contract + `createBackendStub`) and the bin
// entry `docsxai-backend` (starts the server). Storage is in-memory by default; `--data-dir=<dir>`
// (or DOCSX_DATA_DIR) persists to disk via `FsStore`. Auth accepts the pre-issued bearer token
// (DOCSX_TOKEN) and OAuth-2.1-issued access tokens (authorization-code + PKCE; see /v1/oauth/*).

export * from "./api.js";
export * from "./app-url.js";
export * from "./store.js";
export * from "./fs-store.js";
export * from "./oauth.js";
export * from "./webhook.js";
export * from "./runner.js";
export * from "./strategy.js";
export { createBackendStub, type BackendStubOptions } from "./server.js";

import { CLI_USAGE, parseCliArgs } from "./cli-args.js";
import { isMainModule } from "./main-module.js";
import { createBackendStub } from "./server.js";

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function runBackendStubCli(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv, process.env);
  if (!parsed.ok) {
    process.stderr.write(`docsxai-backend: ${parsed.message}\n${CLI_USAGE}\n`);
    return 2;
  }
  const { port, dataDir } = parsed;
  let stub: ReturnType<typeof createBackendStub>;
  try {
    stub = createBackendStub({
      ...(process.env.DOCSX_TOKEN ? { token: process.env.DOCSX_TOKEN } : {}),
      ...(dataDir ? { dataDir } : {}),
    });
  } catch (e) {
    process.stderr.write(`docsxai-backend: cannot use data dir "${dataDir}": ${errorText(e)}\n`);
    return 1;
  }
  let url: string;
  try {
    url = await stub.listen(port);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const why =
      code === "EADDRINUSE"
        ? "the port is already in use, pick another with --port=<n>"
        : code === "EACCES"
          ? "permission denied for that port"
          : errorText(e);
    process.stderr.write(`docsxai-backend: cannot listen on 127.0.0.1:${port}: ${why}\n`);
    return 1;
  }
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

if (isMainModule(import.meta.url, process.argv[1])) {
  void runBackendStubCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
