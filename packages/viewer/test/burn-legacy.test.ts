import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBurnTree } from "../src/burn.js";
import { widthLadder } from "../src/burn-callout.js";
import { parseFontMetrics } from "../src/font-metrics.js";
import { LEGACY_SCENARIOS } from "./helpers/legacy-scenarios.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const legacy = JSON.parse(
  await fs.readFile(new URL("./fixtures/legacy-burn-trees.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("burn output without the new options", () => {
  it("only holds scenarios whose width ladder is the fixed 280, as before the ladder existed", () => {
    for (const scenario of LEGACY_SCENARIOS) {
      for (const a of scenario.annotations) {
        expect(
          widthLadder(scenario.image.width, (a.obstacles?.length ?? 0) > 0, a.placement),
          scenario.name,
        ).toEqual([280]);
      }
    }
  });

  for (const scenario of LEGACY_SCENARIOS) {
    it(`is identical to the output before adaptive width and placement: ${scenario.name}`, () => {
      const tree = buildBurnTree({
        image: { ...scenario.image, dataUri: "data:image/png;base64,AAAA" },
        annotations: structuredClone(scenario.annotations),
        metrics: METRICS,
      });
      const expected = legacy[scenario.name];
      expect(expected).toBeDefined();
      expect(JSON.parse(JSON.stringify(tree))).toEqual(expected);
    });
  }

  it("does not read the report or the capture-only placement keys", () => {
    const [scenario] = LEGACY_SCENARIOS;
    const input = {
      image: { ...scenario!.image, dataUri: "data:image/png;base64,AAAA" },
      metrics: METRICS,
    };
    const plain = buildBurnTree({ ...input, annotations: scenario!.annotations });
    const reported = buildBurnTree({ ...input, annotations: scenario!.annotations, report: [] });
    expect(reported).toEqual(plain);
    const scanned = scenario!.annotations.map((a) => ({
      ...a,
      placement: { obstacle_radius: 40, obstacle_limit: 3 },
    }));
    expect(buildBurnTree({ ...input, annotations: scanned })).toEqual(plain);
  });
});
