// Shared builders for the plugin-runtime test suite. Fixture plugins live under
// fixtures/plugins/<name>/ as tiny real packages (package.json + register module).

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "plugins",
);

export function fixturePlugin(name: string): string {
  return path.join(PLUGIN_FIXTURES_DIR, name);
}

const createdWorkspaces: string[] = [];

/** Temp workspace with a `.site-docs.json`; `overrides` merge into the config JSON. */
export async function makeWorkspace(overrides: Record<string, unknown> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-plugins-test-"));
  createdWorkspaces.push(dir);
  const cfg = {
    schema: "site-docs/workspace@1",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  await fs.writeFile(
    path.join(dir, ".site-docs.json"),
    JSON.stringify(cfg, null, 2) + "\n",
    "utf8",
  );
  return dir;
}

export async function cleanupWorkspaces(): Promise<void> {
  while (createdWorkspaces.length > 0) {
    await fs.rm(createdWorkspaces.pop()!, { recursive: true, force: true });
  }
}

/** Write a minimal loadable plugin into a temp dir (so tests can tamper with its bytes). */
export async function writeTempPlugin(
  parentDir: string,
  overrides: { name?: string; namespace?: string; version?: string } = {},
): Promise<string> {
  const namespace = overrides.namespace ?? "temp";
  const dir = path.join(parentDir, `plugin-${namespace}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: overrides.name ?? `docsxai-plugin-${namespace}-temp`,
        version: overrides.version ?? "1.0.0",
        type: "module",
        private: true,
        docsxai: {
          apiVersion: "1.0.0",
          namespace,
          register: "./register.mjs",
          kinds: ["publisher"],
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "register.mjs"),
    'export function register(api) {\n  api.registerPublisher("pub", {\n    publish: async () => ({ ok: true, target: "t", pages: [], warnings: [] }),\n  });\n}\n',
    "utf8",
  );
  return dir;
}
