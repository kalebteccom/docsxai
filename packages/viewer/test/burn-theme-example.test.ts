// examples/burn-theme/docsxai.json is a sample adopters copy. It has to stay a valid workspace
// config whose burn.theme block passes the same parser `burn`, `pack` and `render` use.

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseThemeConfig } from "../src/burn-theme-config.js";
import { loadBurnTheme } from "../src/burn-theme-load.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, "../../../examples/burn-theme/docsxai.json");

describe("examples/burn-theme", () => {
  const cfg = JSON.parse(readFileSync(file, "utf8")) as {
    schema: string;
    burn: { theme: unknown };
  };

  it("is a workspace config with a burn.theme block that parses", () => {
    expect(cfg.schema).toBe("docsxai/workspace@1");
    const theme = parseThemeConfig(cfg.burn.theme);
    expect(theme.preset).toBe("readable");
    // A plain number display_width also resets the narrow pair, so the layer holds those keys too.
    expect(theme.inline).toMatchObject({ displayWidth: 720, accent: "#0b6e4f" });
  });
});

describe("examples/burn-theme tokens files", () => {
  const dir = path.resolve(here, "../../../examples/burn-theme");
  const render = { scale: "render.scale", display_width: "render.display-width" };

  it.each(["trackxai", "remotxai"].flatMap((p) => ["light", "dark"].map((t) => [p, t] as const)))(
    "%s-%s.tokens.json loads through the theme loader",
    async (project, mode) => {
      const name = `${project}-${mode}.tokens.json`;
      const workspace = mkdtempSync(path.join(tmpdir(), "burn-tokens-"));
      try {
        copyFileSync(path.join(dir, name), path.join(workspace, name));
        writeFileSync(
          path.join(workspace, ".docsxai.json"),
          JSON.stringify({ burn: { theme: { from: name, tokens: render } } }),
        );
        const loaded = await loadBurnTheme(workspace);
        expect(loaded?.theme.scale).toBe("auto");
        expect(loaded?.theme.displayWidthNarrow).toBe(project === "remotxai" ? 390 : 350);
        expect(loaded?.theme.narrowBelow).toBe(900);
        expect(loaded?.theme.displayWidth).toBe(project === "remotxai" ? 800 : 1100);
        expect(loaded?.warnings).toEqual([]);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
});
