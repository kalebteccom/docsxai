// A viewport name is a directory under docs/<flow>/, so it cannot be a name the pull validator
// refuses (`screenshots`, a Windows device name) or one the flow directory already uses (`halts`).

import { describe, expect, it } from "vitest";
import { MatrixSpec, VariantSelector } from "../src/matrix-spec.js";

const viewport = (name: string) => ({ viewports: [{ name, width: 800, height: 600 }] });

describe("viewport names", () => {
  it.each(["screenshots", "halts", "con", "nul", "aux", "prn", "com1", "lpt9"])(
    "%s is refused",
    (name) => {
      const r = MatrixSpec.safeParse(viewport(name));
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toContain("is reserved");
    },
  );

  it("is refused in an only/skip selector too", () => {
    expect(VariantSelector.safeParse({ viewport: ["screenshots"] }).success).toBe(false);
  });

  it.each(["mobile-390", "console", "screens", "com10", "wide"])("%s is accepted", (name) => {
    expect(MatrixSpec.safeParse(viewport(name)).success).toBe(true);
  });
});
