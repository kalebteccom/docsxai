// Backend / sync commands — everything that talks to `@docsxai/backend` over HTTP, plus the plugins
// subcommand delegation:
//   login    — validate a bearer token (or run the OAuth 2.1 + PKCE flow with --oauth)
//   push     — serialise the doc pack and POST it as a new revision (binds the workspace on first push)
//   pull     — fetch a revision's artifacts back into the workspace files
//   plugins  — forwards to plugins-cli (list | info | sync over the plugin runtime; no plugin code runs)

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  BackendClient,
  BackendClientError,
  createBackendClient,
  oauthLogin,
  saveBackendTokenFile,
} from "./backend-client.js";
import {
  type DocPackPayloads,
  fetchScreenshotBlobs,
  readDocPack,
  uploadScreenshotBlobs,
  writeDocPack,
} from "./doc-pack-io.js";
import { pluginsCli } from "./plugins-cli.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { parseFlags } from "./cli-shared.js";

export async function cmdLogin(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const backendUrl =
    typeof flags.get("backend-url") === "string" ? (flags.get("backend-url") as string) : undefined;
  if (!backendUrl) {
    process.stderr.write(`login: --backend-url <url> required\n`);
    return 2;
  }
  const oauthFlag = flags.get("oauth");
  if (oauthFlag !== undefined) {
    // OAuth 2.1 authorization-code + PKCE against the backend's authorization server. Tokens land
    // at <workspace>/.auth/backend-token.json (mode 0600); push/pull/run pick them up from there.
    // The flag parser hands `--oauth <dir>` the dir as the flag value; bare `--oauth` reads it
    // from the positional.
    const workspaceDir = typeof oauthFlag === "string" ? oauthFlag : positionals[0];
    if (!workspaceDir) {
      process.stderr.write(
        `login: --oauth requires a <workspace-dir> (tokens are stored at <workspace>/.auth/backend-token.json)\n`,
      );
      return 2;
    }
    try {
      const tokens = await oauthLogin({
        backendUrl,
        onAuthorizeUrl: (u) => {
          process.stdout.write(`login: open this URL in your browser to authorize:\n  ${u}\n`);
        },
      });
      const storedAt = await saveBackendTokenFile(workspaceDir, tokens);
      process.stdout.write(
        `login: ok. tokens stored at ${storedAt} (access token expires ${new Date(tokens.expires_at).toISOString()})\n`,
      );
      return 0;
    } catch (e) {
      process.stderr.write(`login: ${(e as Error).message}\n`);
      return 1;
    }
  }
  if (!process.env.DOCSX_TOKEN) {
    process.stderr.write(
      `login: DOCSX_TOKEN env var not set. Export it before running: DOCSX_TOKEN=<token> docsxai login --backend-url ${backendUrl}\n`,
    );
    return 2;
  }
  let client: BackendClient;
  try {
    client = new BackendClient({ baseUrl: backendUrl });
  } catch (e) {
    process.stderr.write(`login: ${(e as Error).message}\n`);
    return 1;
  }
  try {
    const h = await client.health();
    if (!h.ok) {
      process.stderr.write(`login: backend health-check returned ok=false\n`);
      return 1;
    }
    const wss = await client.listWorkspaces();
    process.stdout.write(
      `login: ok. ${wss.length} workspace${wss.length !== 1 ? "s" : ""} visible at ${backendUrl}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`login: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

/** Ensure the workspace has a backend workspace + project to push to; create them on first push. */
async function ensureBackendBinding(
  client: BackendClient,
  projectDir: string,
  cfg: { backend_workspace_id?: string; backend_project_id?: string },
  workspaceName: string,
): Promise<{ wsId: string; projectId: string; createdAny: boolean }> {
  let wsId = cfg.backend_workspace_id;
  let projectId = cfg.backend_project_id;
  let createdAny = false;
  if (!wsId) {
    const ws = await client.createWorkspace(workspaceName);
    wsId = ws.id;
    createdAny = true;
  }
  if (!projectId) {
    const proj = await client.createProject(wsId, workspaceName);
    projectId = proj.id;
    createdAny = true;
  }
  return { wsId, projectId, createdAny };
}

export async function cmdPush(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`push: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url) {
    process.stderr.write(
      `push: no backend_url in ${path.join(projectDir, ".docsxai.json")}. Set it before pushing.\n`,
    );
    return 2;
  }
  const kindArg =
    typeof flags.get("kind") === "string" ? (flags.get("kind") as string) : "calibrate";
  if (kindArg !== "calibrate" && kindArg !== "run" && kindArg !== "edit") {
    process.stderr.write(`push: --kind must be calibrate | run | edit (got "${kindArg}")\n`);
    return 2;
  }
  const author =
    (typeof flags.get("author") === "string" ? (flags.get("author") as string) : null) ??
    process.env.USER ??
    "unknown";

  let client: BackendClient;
  try {
    client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: projectDir });
  } catch (e) {
    process.stderr.write(`push: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    const binding = await ensureBackendBinding(
      client,
      projectDir,
      wsCfg,
      path.basename(path.resolve(projectDir)),
    );
    if (binding.createdAny) {
      // Persist the new IDs back to .docsxai.json so subsequent push/pull don't re-create.
      const updated = {
        ...wsCfg,
        backend_workspace_id: binding.wsId,
        backend_project_id: binding.projectId,
      };
      await fs.writeFile(
        resolveWorkspacePath(projectDir, ".docsxai.json"),
        JSON.stringify(updated, null, 2) + "\n",
        "utf8",
      );
    }

    const rev = await client.createRevision(binding.wsId, binding.projectId, {
      kind: kindArg,
      author,
    });
    const payloads = await readDocPack(projectDir);
    if (payloads.screenshots) {
      // Screenshot bytes go up as content-addressed blobs (HEAD-probed, so unchanged PNGs are
      // skipped); the artifact slot carries only the sha256 manifest.
      const { uploaded, skipped } = await uploadScreenshotBlobs(
        projectDir,
        payloads.screenshots,
        client,
      );
      process.stdout.write(
        `push: screenshots — ${uploaded} blob(s) uploaded, ${skipped} already on the backend\n`,
      );
    }
    let pushed = 0;
    for (const [key, p] of Object.entries(payloads) as Array<
      [keyof DocPackPayloads, DocPackPayloads[keyof DocPackPayloads]]
    >) {
      if (p === null) continue;
      await client.putArtifact(binding.wsId, binding.projectId, rev.id, key, p);
      pushed++;
    }
    await client.finalizeRevision(binding.wsId, binding.projectId, rev.id);
    process.stdout.write(
      `push: revision ${rev.id} (${kindArg}, ${author}) — ${pushed} artifact slot${pushed !== 1 ? "s" : ""} uploaded, finalized\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`push: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export async function cmdPull(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`pull: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url || !wsCfg.backend_workspace_id || !wsCfg.backend_project_id) {
    process.stderr.write(
      `pull: workspace isn't bound to a backend yet. Run \`push\` first (or hand-edit .docsxai.json's backend_workspace_id / backend_project_id).\n`,
    );
    return 2;
  }
  const revArg = typeof flags.get("rev") === "string" ? (flags.get("rev") as string) : "head";

  let client: BackendClient;
  try {
    client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: projectDir });
  } catch (e) {
    process.stderr.write(`pull: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    const rev = await client.getRevision(
      wsCfg.backend_workspace_id,
      wsCfg.backend_project_id,
      revArg,
    );
    const payloads: Partial<DocPackPayloads> = {};
    for (const artifact of rev.artifacts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payloads as any)[artifact] = await client.getArtifact(
        wsCfg.backend_workspace_id,
        wsCfg.backend_project_id,
        rev.id,
        artifact,
      );
    }
    // The screenshots artifact is a sha256 manifest — fetch the bytes behind it (integrity-checked).
    const screenshotBytes = payloads.screenshots
      ? await fetchScreenshotBlobs(payloads.screenshots, client)
      : undefined;
    const r = await writeDocPack(projectDir, payloads, screenshotBytes ? { screenshotBytes } : {});
    process.stdout.write(
      `pull: revision ${rev.id} (${rev.kind}, ${rev.author}) — wrote ${r.filesWritten} file(s)\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`pull: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

/** `docsxai plugins …` — forwards to the plugin-runtime CLI verbatim. */
export async function cmdPlugins(args: string[]): Promise<number> {
  return pluginsCli(args);
}
