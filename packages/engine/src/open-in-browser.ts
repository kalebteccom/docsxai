// Open a local file in the default browser, for `docsxai render --open`. One argv array per
// platform and no shell, so a path with spaces, quotes or `&` reaches the opener as one argument:
// `open` on macOS, `explorer.exe` on Windows (cmd's `start` would need a shell to parse the line),
// `xdg-open` elsewhere. Never throws: it resolves `false` when it can't open anything.

import { spawn as nodeSpawn } from "node:child_process";

export interface OpenCommand {
  command: string;
  args: string[];
}

/** The minimal child-process surface {@link openInBrowser} uses, so tests can stand in for it. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; detached: true },
) => {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (e: Error) => void): unknown;
  unref(): void;
};

/** The opener for `platform`, or `undefined` on a Linux or BSD host with no display. */
export function browserOpener(
  target: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): OpenCommand | undefined {
  if (platform === "darwin") return { command: "open", args: [target] };
  if (platform === "win32") return { command: "explorer.exe", args: [target] };
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return undefined;
  return { command: "xdg-open", args: [target] };
}

export interface OpenOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnLike;
}

/** Hand `target` to the platform's opener. Resolves `true` once the opener started, `false` otherwise. */
export function openInBrowser(target: string, opts: OpenOptions = {}): Promise<boolean> {
  const opener = browserOpener(target, opts.platform, opts.env);
  if (!opener) return Promise.resolve(false);
  const spawn: SpawnLike = opts.spawn ?? nodeSpawn;
  return new Promise<boolean>((resolve) => {
    let child: ReturnType<SpawnLike>;
    try {
      child = spawn(opener.command, opener.args, { stdio: "ignore", detached: true });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
