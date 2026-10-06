// Argv for the engine CLI subcommands the webhook runner spawns. The engine reads the
// workspace as the first positional argument (`docsxai run <workspace-dir>`); it has no
// `--workspace` flag. Kept as a pure leaf so a test can feed the result to the engine's own
// argument parser.

/** Where `docsxai render <workspace-dir>` writes the viewer, relative to the workspace. */
export const RENDER_OUT_DIR = ".viewer";

/** `docsxai run <workspace-dir>` */
export function engineRunArgv(workspaceDir: string): string[] {
  return ["run", workspaceDir];
}

/** `docsxai render <workspace-dir>`; the output lands in `<workspace-dir>/.viewer`. */
export function engineRenderArgv(workspaceDir: string): string[] {
  return ["render", workspaceDir];
}
