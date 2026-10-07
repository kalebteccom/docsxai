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
  createBackendClient,
  oauthLogin,
  saveBackendTokenFile,
} from "./backend-client.js";
import {
  type DocPackPayloads,
  fetchScreenshotBlobs,
  readDocPack,
  UnsafePackNameError,
  uploadScreenshotBlobs,
  writeDocPack,
} from "./doc-pack-io.js";
import { pluginsCli } from "./plugins-cli.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { parseFlags } from "./cli-shared.js";
import { configProblem, explainBackendFailure } from "./cli-backend-errors.js";
import {
  redactUrl,
  sanitizeForTerminal,
  shellQuote,
  usageError,
  withNext,
} from "./cli-messages.js";

export async function cmdLogin(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const backendUrl =
    typeof flags.get("backend-url") === "string" ? (flags.get("backend-url") as string) : undefined;
  if (!backendUrl) {
    return usageError("login", "--backend-url <url> required");
  }
  const oauthFlag = flags.get("oauth");
  if (oauthFlag !== undefined) {
    // OAuth 2.1 authorization-code + PKCE against the backend's authorization server. Tokens land
    // at <workspace>/.auth/backend-token.json (mode 0600); push/pull/run pick them up from there.
    // The flag parser hands `--oauth <dir>` the dir as the flag value; bare `--oauth` reads it
    // from the positional.
    const workspaceDir = typeof oauthFlag === "string" ? oauthFlag : positionals[0];
    if (!workspaceDir) {
      return usageError(
        "login",
        "--oauth requires a <workspace-dir> (tokens are stored at <workspace>/.auth/backend-token.json)",
      );
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
      const text =
        explainBackendFailure(e, backendUrl) ?? sanitizeForTerminal((e as Error).message);
      process.stderr.write(`login: ${text}\n`);
      return 1;
    }
  }
  if (!process.env.DOCSX_TOKEN) {
    const next = `DOCSX_TOKEN=<token> docsxai login --backend-url ${shellQuote(redactUrl(backendUrl))}  (or add --oauth <workspace-dir> to sign in as a person)`;
    process.stderr.write(`login: ${withNext("DOCSX_TOKEN env var not set", next)}\n`);
    return 2;
  }
  let client: BackendClient;
  try {
    client = new BackendClient({ baseUrl: backendUrl });
  } catch (e) {
    process.stderr.write(`login: ${sanitizeForTerminal((e as Error).message)}\n`);
    return 1;
  }
  try {
    const h = await client.health();
    if (!h.ok) {
      const note = withNext(
        `backend health-check at ${redactUrl(backendUrl)} returned ok=false`,
        "check the backend's logs, then retry",
      );
      process.stderr.write(`login: ${note}\n`);
      return 1;
    }
    const wss = await client.listWorkspaces();
    process.stdout.write(
      `login: ok. ${wss.length} workspace${wss.length !== 1 ? "s" : ""} visible at ${redactUrl(backendUrl)}\n`,
    );
    return 0;
  } catch (e) {
    const text = explainBackendFailure(e, backendUrl);
    if (text === undefined) throw e;
    process.stderr.write(`login: ${text}\n`);
    return 1;
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
  if (!positionals[0]) return usageError("push", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url) {
    const file = path.join(projectDir, ".docsxai.json");
    const why = wsCfg ? "" : ` (${await configProblem(projectDir)})`;
    const next = 'add "backend_url": "<url>" to it, then docsxai login --backend-url <url>';
    process.stderr.write(`push: ${withNext(`no backend_url in ${file}${why}`, next)}\n`);
    return 2;
  }
  const kindArg =
    typeof flags.get("kind") === "string" ? (flags.get("kind") as string) : "calibrate";
  if (kindArg !== "calibrate" && kindArg !== "run" && kindArg !== "edit") {
    return usageError("push", `--kind must be calibrate | run | edit (got "${kindArg}")`);
  }
  const author =
    (typeof flags.get("author") === "string" ? (flags.get("author") as string) : null) ??
    process.env.USER ??
    "unknown";

  let client: BackendClient;
  try {
    client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: projectDir });
  } catch (e) {
    process.stderr.write(`push: ${sanitizeForTerminal((e as Error).message)}\n`);
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
      `push: revision ${sanitizeForTerminal(rev.id)} (${kindArg}, ${sanitizeForTerminal(author)}) on ${redactUrl(wsCfg.backend_url)} — ${pushed} artifact slot${pushed !== 1 ? "s" : ""} uploaded, finalized\n`,
    );
    return 0;
  } catch (e) {
    const text = explainBackendFailure(e, wsCfg.backend_url, projectDir);
    if (text === undefined) throw e;
    process.stderr.write(`push: ${text}\n`);
    return 1;
  }
}

export async function cmdPull(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) return usageError("pull", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url || !wsCfg.backend_workspace_id || !wsCfg.backend_project_id) {
    const gap = wsCfg
      ? "backend_url, backend_workspace_id and backend_project_id are all needed"
      : await configProblem(projectDir);
    const next = `docsxai push ${shellQuote(projectDir)}  (binds it on the first push), or set the three keys in .docsxai.json`;
    process.stderr.write(
      `pull: ${withNext(`workspace isn't bound to a backend yet (${gap})`, next)}\n`,
    );
    return 2;
  }
  const revArg = typeof flags.get("rev") === "string" ? (flags.get("rev") as string) : "head";

  let client: BackendClient;
  try {
    client = await createBackendClient({ baseUrl: wsCfg.backend_url, workspaceDir: projectDir });
  } catch (e) {
    process.stderr.write(`pull: ${sanitizeForTerminal((e as Error).message)}\n`);
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
      `pull: revision ${sanitizeForTerminal(rev.id)} (${sanitizeForTerminal(rev.kind)}, ${sanitizeForTerminal(rev.author)}) — wrote ${r.filesWritten} file(s) to ${sanitizeForTerminal(projectDir)}\n`,
    );
    return 0;
  } catch (e) {
    const text =
      e instanceof UnsafePackNameError
        ? withNext(
            `${sanitizeForTerminal(e.message)}\n  why: the revision names a file a workspace would not produce; nothing was written`,
            `docsxai pull ${shellQuote(projectDir)} --rev <older-revision-id>`,
          )
        : explainBackendFailure(e, wsCfg.backend_url, projectDir);
    if (text === undefined) throw e;
    process.stderr.write(`pull: ${text}\n`);
    return 1;
  }
}

/** `docsxai plugins …` — forwards to the plugin-runtime CLI verbatim. */
export async function cmdPlugins(args: string[]): Promise<number> {
  return pluginsCli(args);
}
