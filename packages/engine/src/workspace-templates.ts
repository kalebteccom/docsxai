// Text of the files `docsxai init` scaffolds: the workspace README and the sample flow-file.
// Kept apart from workspace.ts so commands and keys named here are easy to review against
// `docsxai --help`.

import type { WorkspaceConfig } from "./workspace.js";

/** Where the sample flow lands. The `.sample` suffix keeps `run`, `lint` and `render` from loading it. */
export const SAMPLE_FLOW_PATH = "flows/example.flow.yaml.sample";

export const SAMPLE_FLOW = `# Sample flow-file. Edit the locators and steps for your app, then:
#   docsxai add-flow . --from ${SAMPLE_FLOW_PATH}
# which writes flows/example.flow.yaml. Full format: docs/agent-runbook.md in the docsxai repo.
name: example
locators:
  heading: h1
steps:
  - id: open-home
    action: navigate
    value: / # a path resolved against app_url in .docsxai.json
    wait_for: load
    success: { visible: $heading }
  - id: point-at-heading
    action: hover
    target: $heading
    success: { visible: $heading }
`;

/** The site `init --example` documents: public, no login. */
export const EXAMPLE_APP_URL = "https://example.com";

/** Where `init --example` writes its flow. */
export const EXAMPLE_FLOW_PATH = "flows/hello.flow.yaml";

/** The README's hello flow: open the home page and point at its English paragraph (the page has no heading). */
export const EXAMPLE_FLOW = `# Written by docsxai init --example. Run it, then build the viewer:
#   docsxai run .
#   docsxai render . --open
name: hello
locators:
  text: 'p[lang="en"]'
steps:
  - id: open-home
    action: navigate
    value: /
    wait_for: load
    success: { visible: $text }
    annotation: { copy: "This is the page text", target: $text, arrow: bottom }
`;

export interface ReadmeOptions {
  auth: "manual-capture" | "none";
  configFile: string;
}

export function workspaceReadme(cfg: WorkspaceConfig, opts: ReadmeOptions): string {
  const login = opts.auth === "manual-capture";
  const authLine = login
    ? "- `auth/strategy.yaml`, how execution authenticates to the app\n- `.auth/<role>.json`, captured session(s) (gitignored; never committed; never leaves this machine)"
    : "- no `auth/` descriptor: this workspace was made with `--auth none`, so flows run without a login";
  const steps = [
    "docsxai doctor .           # check Node, Chromium, this config and app_url reachability",
    ...(login
      ? [
          "docsxai capture-auth .     # opens an instrumented browser; log in, then run window.__docsxai.capture()",
        ]
      : []),
    `docsxai add-flow . --from ${SAMPLE_FLOW_PATH}   # edit the sample first, or pass a flow-file you wrote`,
    "docsxai run .              # replay the flow-files headlessly; refresh annotations + screenshots",
    "docsxai render . && open .viewer/index.html",
  ];
  return `# docsxai workspace

This directory is a **docsxai workspace**, it holds the doc pack for one running app:

- \`flows/<flow>.flow.yaml\`, hand-editable flow-files (the source of truth for execution)
- \`${SAMPLE_FLOW_PATH}\`: a sample flow-file to copy from (ignored until you add it with add-flow)
- \`docs/<flow>/{annotations.json, screenshots/, <step>.md}\`, \`docs/{style.yaml, locators.yaml}\`, the generated docs
${authLine}
- \`.viewer/\`, the generated interactive viewer (gitignored)
- \`${opts.configFile}\`, workspace config (\`app_url${cfg.app_url ? ` = ${cfg.app_url}` : ""}\`, \`ignore_https_errors = ${!!cfg.ignore_https_errors}\`)

**Do NOT place this directory inside the app's source repo.** docsxai documents the *running* app from outside;
keeping the workspace separate is what guarantees zero traces in the app repo.
${login ? "\nThe app needs no login? Scaffold with `docsxai init <dir> --auth none` and skip `capture-auth`.\n" : ""}
Usage (from this directory):

\`\`\`
${steps.join("\n")}
\`\`\`

## Optional: caption theme

Add a \`burn.theme\` block to \`${opts.configFile}\` to restyle burned captions and the viewer overlay:

\`\`\`json
{ "burn": { "theme": { "preset": "readable", "accent": "#0b6e4f" } } }
\`\`\`

Presets: \`clean\`, \`soft\`, \`high-contrast\`, \`readable\`. \`docsxai burn .\` lists theme problems and contrast warnings. Keys: docs/burn-theming.md in the docsxai repo.
`;
}
