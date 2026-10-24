// A Node too old to load Playwright gets one `docsxai:` line with the version, the requirement and
// the next step, before Playwright's own text can appear.

import { describe, expect, it } from "vitest";
import { nodeFloorMessage } from "../src/node-floor.js";

describe("nodeFloorMessage", () => {
  it.each(["18.20.5", "16.0.0", "19.1.0"])("explains Node %s", (version) => {
    const text = nodeFloorMessage(version)!;
    expect(text).toContain(`docsxai: Node v${version} is too old to start`);
    expect(text).toContain("requires Node >= 26");
    expect(text).toContain("next: install Node 26 or newer");
    expect(text.endsWith("\n")).toBe(true);
  });

  it.each(["20.0.0", "22.23.3", "26.5.0"])("lets Node %s through", (version) => {
    expect(nodeFloorMessage(version)).toBeUndefined();
  });
});
