// Over HTTP the caller is a token holder on the network. A tool error that quotes a path outside
// the workspace root (a Chromium cache under a home directory, a stack frame in node_modules, the
// server's working directory) tells that caller how the host is laid out. This replaces every
// absolute path outside the root with `<path>`: POSIX paths, `file://` URLs, drive-letter paths
// and UNC paths, after `..` and `.` segments are resolved. In the free-text fields of a result a
// path inside the root becomes root-relative, which is also how a caller passes it back.
//
// Best effort. A path with spaces is only found whole when it sits in quotes or parentheses;
// bare, it is cut at the first space. Text that merely looks like a path (an XPath in a message)
// is replaced too. HTTP method routes (`POST /v1/x`) are left alone. stdio does not scrub: the
// caller owns the machine.

import * as path from "node:path";
import type { ToolResult } from "./shared.js";

/** Result fields that carry free text from the engine, the OS or a child process. */
const TEXT_KEYS = new Set([
  "error",
  "hint",
  "hintForFixes",
  "output",
  "pluginRuleWarning",
  "statusReason",
  "haltCause",
  "message",
  "suggestion",
  "rationale",
]);

/** Fields whose whole value is a path or a `path:` source, such as a plugin's `source`. */
const PATH_KEYS = new Set([
  "source",
  "path",
  "dir",
  "workspace",
  "outDir",
  "screenshotAbsPath",
  "indexHtml",
  "viewerIndex",
]);

/** What starts an absolute path: a `file://` URL, a UNC share, a drive letter or a POSIX `/segment`. */
const START =
  "file:\\/\\/|\\\\\\\\[\\w.$-]|[A-Za-z]:[\\\\/]|(?<!(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) )\\/(?=[\\w.~@%+-])";

/** A path in quotes or parentheses runs to the closing mark, spaces included. */
const QUOTED = new RegExp(`(["'\`])((?:${START}).*?)\\1`, "g");
const PARENTHESISED = new RegExp(`\\(((?:${START}).*?)\\)`, "g");
/** A bare path runs to whitespace, a quote or an angle bracket. */
const BARE = new RegExp(`(?<![\\w/\\\\.])(?:${START})[^\\s"'\`<>|*?]*`, "g");
/** A whole string that is a path, optionally behind a `path:` label (plugin sources). */
const WHOLE_PATH = new RegExp(`^(?:path:)?(?:${START})`);

const TRAILING_PUNCTUATION = /[).,;:\]}]+$/;

function slashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `found` as the caller may see it: `<path>` outside the root; inside it, root-relative when
 * `relative` is set and unchanged otherwise.
 */
function replacePath(found: string, root: string, relative: boolean): string {
  let candidate = found;
  if (/^file:\/\//i.test(candidate)) {
    candidate = decode(candidate.replace(/^file:\/\/(?:localhost)?/i, "")).replace(
      /^\/(?=[A-Za-z]:)/,
      "",
    );
  }
  const normal = path.posix.normalize(slashes(candidate));
  const base = path.posix.normalize(slashes(root)).replace(/\/+$/, "");
  const prefix = `${base}/`;
  if (normal !== base && !normal.startsWith(prefix)) return "<path>";
  if (!relative) return found;
  return normal === base ? "." : normal.slice(prefix.length);
}

/** `text` with every absolute path outside `root` replaced by `<path>` (see the file header). */
export function scrubOutsideRoot(text: string, root: string, relative = true): string {
  const swap = (found: string) => replacePath(found, root, relative);
  return text
    .replace(QUOTED, (_m, quote: string, body: string) => `${quote}${swap(body)}${quote}`)
    .replace(PARENTHESISED, (_m, body: string) => `(${swap(body)})`)
    .replace(BARE, (match) => {
      // Closing punctuation after a path ("see /a/b.") is not part of it.
      const trailing = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
      const found = trailing ? match.slice(0, -trailing.length) : match;
      return swap(found) + trailing;
    });
}

/**
 * `result` with absolute paths outside `root` replaced. Free-text fields are scrubbed
 * throughout; a field that holds a path (a plugin `source`) is scrubbed when its whole value is
 * one. Other strings, such as annotation copy and selectors, stay as they are. Paths inside the root in
 * fields like `workspace` and `dir` stay absolute.
 */
export function scrubResult<T extends ToolResult>(result: T, root: string): T {
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      if (key !== undefined && TEXT_KEYS.has(key)) return scrubOutsideRoot(value, root);
      return key !== undefined && PATH_KEYS.has(key) && WHOLE_PATH.test(value)
        ? scrubOutsideRoot(value, root, false)
        : value;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    return value;
  };
  return walk(result) as T;
}
