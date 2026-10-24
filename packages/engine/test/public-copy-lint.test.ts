// Public copy lint. Four surfaces a reader of docsxai sees: the landing, getting-started and
// concepts pages, llms.txt and the site components (scope `site`), the text the viewer emits into
// pages (scope `ui`, the `en` and `es` tables of ui-strings.ts), the user-facing CLI messages
// (scope `cli`) and the MCP messages (scope `mcp`). The last two are the string literals passed to
// `throw new Error`, `process.stderr.write` and `console.error`, found with the TypeScript AST.
// Each scope is checked for environment-variable-like tokens, internal hostnames and paths,
// private IPs and ticket or spec ids. `DOCSX_*` variables are product surface, but a landing page
// or the emitted UI has no reason to name one, so each scope has its own allowlist below, with a
// reason per entry. Allowed tokens are matched one by one, so a forbidden name on the same line as
// an allowed one still fails. A planted bad string for each rule is in the matcher tests. A second
// pass over mirrored docs, CHANGELOG and package READMEs only prints its hits.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { KNOWN_DOCSX_ENV_VARS } from "../src/doctor-checks.js";
import { UI_TABLES } from "../../viewer/src/ui-strings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

type Scope = "site" | "ui" | "cli" | "mcp";

// --- allowlists ------------------------------------------------------------------------------

/** Tokens that are legitimate in every scope, with the reason. */
const STANDARD_TOKENS: Readonly<Record<string, string>> = {
  SIGINT: "POSIX signal name, printed when a run is interrupted",
  SIGTERM: "POSIX signal name",
  SIGKILL: "POSIX signal name",
  SIGHUP: "POSIX signal name",
  UTF_8: "character set name, as in the HTTP and file encoding vocabulary",
};

/** User knobs documented in the engine and mcp READMEs; error messages name them so a user can act. */
const EGRESS_KNOBS: Readonly<Record<string, string>> = {
  DOCSX_EGRESS_GUARD: "documented user knob: `DOCSX_EGRESS_GUARD=0` turns the outbound guard off",
  DOCSX_EGRESS_DENY_PRIVATE: "documented user knob: also deny private addresses",
};

/** Per-scope tokens beyond the standard ones. */
const SCOPE_TOKENS: Readonly<Record<Scope, Readonly<Record<string, string>>>> = {
  site: {
    BROWX_TEST_ATTRIBUTES:
      "browxai's documented variable, named on the browxai ecosystem page so a reader can configure the sibling tool",
  },
  ui: {},
  cli: EGRESS_KNOBS,
  mcp: EGRESS_KNOBS,
};

/**
 * Where a documented `DOCSX_*` name may appear. Reference pages and the self-hoster's error
 * messages name the variable to set. The landing, getting-started and concepts pages and the
 * emitted UI do not: a new reader meets no environment variable there.
 */
const DOCSX_ALLOWED_IN: Readonly<Record<Scope, boolean>> = {
  site: false,
  ui: false,
  cli: true,
  mcp: true,
};

/** `DOCSX_WEBHOOK_SECRET_<NAME>`: the backend reads one secret variable per configured webhook. */
const DOCSX_PREFIX_FAMILIES: ReadonlyArray<string> = ["DOCSX_WEBHOOK_SECRET_"];

/** Hosts that may appear in public copy, with the reason. */
const ALLOWED_HOSTS: Readonly<Record<string, string>> = {
  "docsxai.dev": "the product site",
  "kalebtec.com": "marketing link in the footer",
  "www.kalebtec.com": "marketing link",
  "github.com": "the repository, kalebteccom/docsxai",
  "npmjs.com": "package pages",
  "www.npmjs.com": "package pages",
};

// --- matcher ---------------------------------------------------------------------------------

export interface Finding {
  rule: string;
  match: string;
}

const ENV_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const KALEBTEC_HOST = /\b(?:[a-z0-9-]+\.)*kalebtec\.com\b/gi;
const PRIVATE_IP =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;
const INTERNAL_PATH = /(?:^|[\s"'`(=])(?:\/srv\/|\/home\/gitops)/g;
/** Case-sensitive: `DOC-` tickets and the spec-id prefixes of docs/public-surface.md (`CLI-03`). */
const TICKET_ID =
  /\b(?:DOC-[0-9]{2,5}|(?:CLI|API|PLUG|VIEW|MCP|PACK|ENV|FLOW|DRV|CFG|LIB|CC)-[0-9]{2,3})\b/g;
const CI_INTERNALS = /\bwoodpecker\b/gi;

const known = new Set(KNOWN_DOCSX_ENV_VARS);

function envTokenAllowed(token: string, scope: Scope): boolean {
  if (token in STANDARD_TOKENS || token in SCOPE_TOKENS[scope]) return true;
  if (token.startsWith("DOCSX_")) {
    if (!DOCSX_ALLOWED_IN[scope]) return false;
    return known.has(token) || DOCSX_PREFIX_FAMILIES.some((p) => token.startsWith(p));
  }
  return false;
}

/** Every leak in `text` as seen from `scope`. */
export function findLeaks(text: string, scope: Scope): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(ENV_TOKEN)) {
    if (!envTokenAllowed(m[0], scope)) out.push({ rule: "env-var-like token", match: m[0] });
  }
  for (const m of text.matchAll(KALEBTEC_HOST)) {
    if (!(m[0].toLowerCase() in ALLOWED_HOSTS))
      out.push({ rule: "internal hostname", match: m[0] });
  }
  for (const m of text.matchAll(PRIVATE_IP)) out.push({ rule: "private IP", match: m[0] });
  for (const m of text.matchAll(INTERNAL_PATH)) {
    out.push({ rule: "internal path", match: m[0].trim().replace(/^["'`(=]/, "") });
  }
  for (const m of text.matchAll(TICKET_ID)) out.push({ rule: "ticket id", match: m[0] });
  for (const m of text.matchAll(CI_INTERNALS)) out.push({ rule: "CI internals", match: m[0] });
  return out;
}

// --- text extraction -------------------------------------------------------------------------

/** The visible text of an Astro component: markup only, no frontmatter, script or style. */
function astroText(src: string): string {
  return src
    .replace(/^---[\s\S]*?\n---/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "");
}

function parse(src: string, tsx = false): ts.SourceFile {
  return ts.createSourceFile(
    tsx ? "x.tsx" : "x.ts",
    src,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The text of every string literal under `node`; `${}` holes are left out, comments never parsed. */
function literalsUnder(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text, ...node.templateSpans.map((sp) => sp.literal.text));
    for (const sp of node.templateSpans) literalsUnder(sp.expression, out);
    return;
  } else if (ts.isJsxText(node)) out.push(node.text);
  ts.forEachChild(node, (c) => literalsUnder(c, out));
}

/** The text of every string literal in `src`. */
export function stringLiterals(src: string, tsx = false): string[] {
  const out: string[] = [];
  literalsUnder(parse(src, tsx), out);
  return out;
}

function isMessageCall(n: ts.Node): n is ts.CallExpression | ts.NewExpression {
  if (ts.isNewExpression(n)) {
    return (
      n.parent !== undefined &&
      ts.isThrowStatement(n.parent) &&
      /Error$/.test(n.expression.getText())
    );
  }
  if (!ts.isCallExpression(n)) return false;
  const callee = n.expression.getText();
  return (
    /^process\.std(?:err|out)\.write$/.test(callee) || /^console\.(?:error|warn|log)$/.test(callee)
  );
}

/** The string literals passed to `throw new Error(`, `process.stderr.write(`, `console.error(` and kin. */
export function cliMessages(src: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (isMessageCall(n)) for (const arg of n.arguments ?? []) literalsUnder(arg, out);
    ts.forEachChild(n, visit);
  };
  visit(parse(src));
  return out;
}

/** Every string value in a nested table of strings. */
function tableStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(tableStrings);
  return [];
}

// --- file walking ----------------------------------------------------------------------------

function filesUnder(dir: string, test: (f: string) => boolean): string[] {
  const abs = path.join(repo, dir);
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && test(e.name))
    .map((e) => path.relative(repo, path.join(e.parentPath, e.name)))
    .sort();
}

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), "utf8");
}

const SITE_PAGES = [
  "website/src/content/docs/index.mdx",
  ...filesUnder("website/src/content/docs/getting-started", (f) => /\.mdx?$/.test(f)),
  ...filesUnder("website/src/content/docs/concepts", (f) => /\.mdx?$/.test(f)),
  "website/public/llms.txt",
];
const SITE_COMPONENTS = filesUnder("website/src", (f) => /\.(astro|tsx)$/.test(f));
/** Files that hold help text as constants: every string literal in them is printed to the terminal. */
const HELP_TEXT_FILES = [
  "packages/engine/src/cli-usage.ts",
  "packages/engine/src/cli-help.ts",
  "packages/engine/src/cli-messages.ts",
  "packages/viewer/src/cli-usage.ts",
  "packages/viewer/src/viewer-help.ts",
];
const CLI_SOURCES = [
  ...filesUnder("packages/engine/src", (f) => f.endsWith(".ts")),
  ...filesUnder("packages/viewer/src", (f) => f.endsWith(".ts")),
];
const MCP_SOURCES = filesUnder("packages/mcp/src", (f) => f.endsWith(".ts"));

function report(label: string, texts: string[], scope: Scope): string[] {
  return texts.flatMap((t) => findLeaks(t, scope).map((f) => `${label}: ${f.rule} "${f.match}"`));
}

// --- tests -----------------------------------------------------------------------------------

describe("public copy: the real surfaces", () => {
  it("site pages and components name no environment variable, internal host, path or id", () => {
    expect(SITE_PAGES.length).toBeGreaterThan(5);
    expect(SITE_COMPONENTS.length).toBeGreaterThan(3);
    const hits = [
      ...SITE_PAGES.flatMap((f) => report(f, [read(f)], "site")),
      ...SITE_COMPONENTS.flatMap((f) =>
        report(
          f,
          f.endsWith(".astro") ? [astroText(read(f))] : stringLiterals(read(f), true),
          "site",
        ),
      ),
    ];
    expect(hits).toEqual([]);
  });

  it("viewer emitted UI strings (en and es) are clean", () => {
    const hits = (["en", "es"] as const).flatMap((lang) =>
      report(`ui-strings ${lang}`, tableStrings(UI_TABLES[lang]), "ui"),
    );
    expect(tableStrings(UI_TABLES.en).length).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });

  it("CLI error and help strings in the engine and viewer sources are clean", () => {
    let scanned = 0;
    const hits: string[] = CLI_SOURCES.flatMap((f) => {
      const msgs = cliMessages(read(f));
      scanned += msgs.length;
      return report(f, msgs, "cli");
    });
    for (const f of HELP_TEXT_FILES) hits.push(...report(f, stringLiterals(read(f)), "cli"));
    expect(scanned).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });

  it("mcp error and message strings are clean", () => {
    let scanned = 0;
    const hits = MCP_SOURCES.flatMap((f) => {
      const msgs = cliMessages(read(f));
      scanned += msgs.length;
      return report(f, msgs, "mcp");
    });
    expect(scanned).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });
});

// --- report-only pass ------------------------------------------------------------------------

/** Patterns for the mirrored docs, CHANGELOG and package READMEs. Hits are printed, never failed on. */
const REPORT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "secret name",
    /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)(?:_[A-Z0-9]+)*\b/g,
  ],
  [
    "hosting provider",
    /\b(?:hetzner|netlify|cloudflare|digitalocean|vercel|coolify|contabo|scaleway|fly\.io|render\.com|heroku)\b/gi,
  ],
  ["server path", /(?:^|[\s"'`(=])\/(?:srv|home)\/[\w.-]+/g],
  ["ai-context pointer", /docs\/ai-context/g],
];

const REPORT_FILES = [
  ...filesUnder("website/src/content/docs", (f) => /\.mdx?$/.test(f)),
  "CHANGELOG.md",
  ...filesUnder("packages", (f) => f === "README.md").filter((f) => !f.includes("node_modules")),
];

/** Every report-only hit in `text`, as `rule match`. */
export function reportHits(text: string): string[] {
  return REPORT_PATTERNS.flatMap(([rule, re]) =>
    [...text.matchAll(re)].map((m) => `${rule} ${m[0].trim()}`),
  );
}

describe("public copy: mirrored docs (report only)", () => {
  it("prints hits in mirrored docs, CHANGELOG and package READMEs without failing", () => {
    const lines = REPORT_FILES.flatMap((f) => reportHits(read(f)).map((h) => `${f}: ${h}`));
    expect(REPORT_FILES.length).toBeGreaterThan(10);
    console.info(`public-copy report-only: ${lines.length} hits\n${lines.join("\n")}`);
  });

  it("helper finds planted secret names, providers, paths and ai-context pointers", () => {
    const hits = reportHits(
      "set GITEA_API_TOKEN on Hetzner, copy to /srv/x, see docs/ai-context/a.md and /home/bob/y",
    );
    for (const rule of ["secret name", "hosting provider", "server path", "ai-context pointer"]) {
      expect(hits.some((h) => h.startsWith(rule + " "))).toBe(true);
    }
    expect(reportHits("plain words")).toEqual([]);
  });
});

const rules = (text: string, scope: Scope): string[] => findLeaks(text, scope).map((f) => f.rule);

describe("public copy: matcher", () => {
  it("still flags a forbidden token on a line that also holds an allowed one", () => {
    expect(rules("set DOCSX_TOKEN and LEAKED_OPS_NAME", "cli")).toEqual(["env-var-like token"]);
    expect(findLeaks("DOCSX_EGRESS_GUARD=0 or INTERNAL_KNOB", "mcp").map((f) => f.match)).toEqual([
      "INTERNAL_KNOB",
    ]);
    expect(findLeaks("DOCSX_TOKEN SIGINT ops.kalebtec.com", "site").map((f) => f.match)).toEqual([
      "DOCSX_TOKEN",
      "ops.kalebtec.com",
    ]);
  });

  it("allows the documented egress knobs in cli and mcp only", () => {
    expect(rules("DOCSX_EGRESS_GUARD=0 DOCSX_EGRESS_DENY_PRIVATE=1", "cli")).toEqual([]);
    expect(rules("DOCSX_EGRESS_GUARD=0", "mcp")).toEqual([]);
    expect(rules("DOCSX_EGRESS_GUARD=0", "ui")).toEqual(["env-var-like token"]);
  });

  it("flags spec-id prefixes with 2 or 3 digits, case-sensitively", () => {
    for (const id of ["CLI-03", "API-10", "PLUG-06", "VIEW-12", "MCP-04", "PACK-11", "ENV-15"]) {
      expect(rules(`see ${id}`, "cli")).toEqual(["ticket id"]);
    }
    expect(rules("cli-03, env-10, SHA-256, UTF-16, RFC-6238, BCP-47, CLI-1", "cli")).toEqual([]);
  });

  it("extracts literals from tsx and ignores comments", () => {
    const src = 'const a = <p title="LEAK_ONE_X">Hi LEAK_TWO_Y</p>; // LEAK_THREE_Z\n';
    const joined = stringLiterals(src, true).join("|");
    expect(joined).toContain("LEAK_ONE_X");
    expect(joined).toContain("LEAK_TWO_Y");
    expect(joined).not.toContain("LEAK_THREE_Z");
  });

  it("flags an ALL_CAPS_WITH_UNDERSCORES token", () => {
    expect(rules("Set MY_SECRET_TOKEN first", "site")).toEqual(["env-var-like token"]);
    expect(rules("Set MY_SECRET_TOKEN first", "cli")).toEqual(["env-var-like token"]);
  });

  it("allows documented DOCSX_* names only where the scope permits", () => {
    expect(rules("set DOCSX_TOKEN", "cli")).toEqual([]);
    expect(rules("set DOCSX_WEBHOOK_SECRET_GITHUB", "cli")).toEqual([]);
    expect(rules("set DOCSX_TOKEN", "site")).toEqual(["env-var-like token"]);
    expect(rules("set DOCSX_TOKEN", "ui")).toEqual(["env-var-like token"]);
  });

  it("flags an undocumented DOCSX_* name even in cli", () => {
    expect(rules("set DOCSX_NOT_A_THING", "cli")).toEqual(["env-var-like token"]);
  });

  it("allows standard signal names and scope-listed names", () => {
    expect(rules("stopped by SIGINT", "cli")).toEqual([]);
    expect(rules("see BROWX_TEST_ATTRIBUTES", "site")).toEqual([]);
    expect(rules("see BROWX_TEST_ATTRIBUTES", "ui")).toEqual(["env-var-like token"]);
  });

  it("does not flag camel case, single words or lowercase snake case", () => {
    expect(rules("ALLCAPS plain_snake camelCase Title_Case", "cli")).toEqual([]);
  });

  it("flags internal hostnames and keeps public links", () => {
    expect(rules("see https://ops.kalebtec.com/x", "site")).toEqual(["internal hostname"]);
    expect(
      rules(
        "https://docsxai.dev https://kalebtec.com https://github.com/kalebteccom/docsxai",
        "site",
      ),
    ).toEqual([]);
  });

  it("flags private IPs", () => {
    for (const ip of ["10.0.4.7", "192.168.1.20", "172.16.0.9", "172.31.255.1"]) {
      expect(rules(`host ${ip}`, "cli")).toEqual(["private IP"]);
    }
    expect(rules("172.32.0.1 and 8.8.8.8", "cli")).toEqual([]);
  });

  it("flags internal paths", () => {
    expect(rules("saved to /srv/docsxai-visual/12", "cli")).toEqual(["internal path"]);
    expect(rules("cd /home/gitops/repo", "cli")).toEqual(["internal path"]);
    expect(rules("a/srv/b is a relative thing", "cli")).toEqual([]);
  });

  it("flags ticket ids", () => {
    expect(rules("fixed in DOC-1234", "site")).toEqual(["ticket id"]);
  });

  it("flags CI internals", () => {
    expect(rules("the Woodpecker runner failed", "ui")).toEqual(["CI internals"]);
  });

  it("extracts only the strings passed to throw, stderr and console.error", () => {
    const src = [
      'const a = "NOT_A_MESSAGE_AT_ALL";',
      "throw new Error(`bad ${SOME_CONST} value, set LEAKED_ONE_NAME`);",
      'process.stderr.write("line " + fmt("x)", y) + "LEAKED_TWO_NAME\\n");',
      'console.error("a", // LEAKED_COMMENT_NAME\n  "b");',
      'throw new TypeError("LEAKED_THREE_NAME");',
    ].join("\n");
    const msgs = cliMessages(src).join("|");
    expect(msgs).toContain("LEAKED_ONE_NAME");
    expect(msgs).toContain("LEAKED_TWO_NAME");
    expect(msgs).toContain("LEAKED_THREE_NAME");
    expect(msgs).not.toContain("NOT_A_MESSAGE_AT_ALL");
    expect(msgs).not.toContain("SOME_CONST");
    expect(msgs).not.toContain("LEAKED_COMMENT_NAME");
  });

  it("reads Astro markup only", () => {
    const src =
      "---\nconst RESET_MS = 1;\n---\n<p>Hello</p>\n<script>const A_B = 2;</script>\n<style>.x{}</style>";
    expect(astroText(src)).toContain("Hello");
    expect(astroText(src)).not.toContain("RESET_MS");
    expect(astroText(src)).not.toContain("A_B");
  });
});
