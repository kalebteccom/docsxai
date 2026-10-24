// examples/burn-theme/docsxai.json is a sample adopters copy. It has to stay a valid workspace
// config whose burn.theme block passes the same parser `burn`, `pack` and `render` use.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseThemeConfig } from "../src/burn-theme-config.js";

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
