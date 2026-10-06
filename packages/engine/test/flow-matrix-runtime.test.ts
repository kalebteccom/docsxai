// The runtime side of the matrix: each variant runs as its own flow (fresh driver, as the CLI gives
// each its own session), writes under its variant directory, and a halt names the variant. A flow
// without a matrix runs, and records, exactly what it did before the matrix existed.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expandFlowVariants, parseFlowFile } from "../src/flow-file.js";
import { FlowExecutionError, runFlow } from "../src/flow-runtime.js";
import { RecordingDriver } from "./recording-driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const TOUR = `
name: tour
locators: { btn: '#btn', title: h1 }
matrix:
  locales: [en-US, es-ES]
  viewports: [{ name: wide, width: 1280, height: 800 }, mobile]
steps:
  - id: open
    action: navigate
    value: /home
  - id: pick
    action: click
    target: $btn
    skip: { viewport: [mobile] }
    annotation: { copy: "Pick", copy_by_locale: { es: "Elige" } }
  - id: tap
    action: click
    target: $btn
    only: { viewport: [mobile] }
    annotations:
      - { copy: "Tap", target: $btn }
      - { copy: "Title", target: $title, only: { locale: [es] } }
`;

const BOX = { x: 10, y: 20, width: 30, height: 40 };

async function runVariant(id: string, setup?: (d: RecordingDriver) => void) {
  const variant = expandFlowVariants(parseFlowFile(TOUR)).find((v) => v.id === id)!;
  const driver = new RecordingDriver();
  setup?.(driver);
  const result = await runFlow(variant.flow, driver, {
    ...(variant.info ? { variant: variant.info } : {}),
  });
  return { driver, result };
}

describe("runFlow per matrix variant", () => {
  it("runs the variants in expansion order, each with its own steps and doc directory", async () => {
    const ids = expandFlowVariants(parseFlowFile(TOUR)).map((v) => v.id!);
    expect(ids).toEqual(["en-US.wide", "en-US.mobile", "es-ES.wide", "es-ES.mobile"]);

    const calls: Record<string, string[]> = {};
    for (const id of ids) calls[id] = (await runVariant(id)).driver.calls;
    expect(calls).toEqual({
      "en-US.wide": [
        "goto /home",
        "click #btn",
        "screenshot docs/tour/en-US.wide/screenshots/pick.png",
      ],
      "en-US.mobile": [
        "goto /home",
        "click #btn",
        "screenshot docs/tour/en-US.mobile/screenshots/tap.png",
      ],
      "es-ES.wide": [
        "goto /home",
        "click #btn",
        "screenshot docs/tour/es-ES.wide/screenshots/pick.png",
      ],
      "es-ES.mobile": [
        "goto /home",
        "click #btn",
        "screenshot docs/tour/es-ES.mobile/screenshots/tap.png",
      ],
    });
  });

  it("records the variant after the flow name, and the resolved copy", async () => {
    const { result } = await runVariant("es-ES.wide");
    expect(Object.keys(result.annotations)).toEqual(["schema", "flow", "variant", "annotations"]);
    expect(result.annotations.flow).toBe("tour");
    expect(result.annotations.variant).toEqual({
      id: "es-ES.wide",
      locale: "es-ES",
      viewport: { name: "wide", width: 1280, height: 800 },
    });
    expect(result.annotations.annotations).toEqual([
      { step: "pick", selector: "#btn", bounding_box: BOX, copy: "Elige" },
    ]);
  });

  it("numbers the call-outs that survive the variant filter", async () => {
    const es = (await runVariant("es-ES.mobile")).result.annotations.annotations;
    expect(es.map((a) => [a.step, a.copy, a.index])).toEqual([
      ["tap", "Tap", 1],
      ["tap", "Title", 2],
    ]);
    const en = (await runVariant("en-US.mobile")).result.annotations.annotations;
    expect(en).toEqual([{ step: "tap", selector: "#btn", bounding_box: BOX, copy: "Tap" }]);
  });

  it("names the variant in a halt and writes the halt shot under its directory", async () => {
    const attempt = runVariant("es-ES.mobile", (d) => d.failClicks.add("#btn"));
    await expect(attempt).rejects.toThrow(
      /\[variant es-ES\.mobile\] step "tap" \(click\) failed at .*\(halt screenshot: docs\/tour\/es-ES\.mobile\/halts\/tap\.png\)/,
    );
    const error = (await attempt.catch((e: unknown) => e)) as FlowExecutionError;
    expect(error).toBeInstanceOf(FlowExecutionError);
    expect(error.variant).toBe("es-ES.mobile");
    expect(error.stepId).toBe("tap");
  });

  it("puts the halt cause before the variant tag", async () => {
    const attempt = runVariant("en-US.wide", (d) => d.failClicks.add("#btn"));
    await expect(attempt).rejects.toThrow(
      /^\[target is not visible[^\]]*\] \[variant en-US\.wide\] /,
    );
  });

  it("refuses a flow that still has a matrix", async () => {
    await expect(runFlow(parseFlowFile(TOUR), new RecordingDriver())).rejects.toThrow(
      /flow "tour" has a `matrix`; expand it/,
    );
  });

  it("an explicit screenshotPath still wins over the variant directory", async () => {
    const variant = expandFlowVariants(parseFlowFile(TOUR))[0]!;
    const driver = new RecordingDriver();
    await runFlow(variant.flow, driver, {
      variant: variant.info!,
      screenshotPath: (flow, step) => `custom/${flow}/${step}.png`,
    });
    expect(driver.screenshots).toEqual(["custom/tour/pick.png"]);
  });
});

describe("a flow without a matrix is byte-identical to the layout before the matrix", () => {
  async function runRecapOpen() {
    const flow = parseFlowFile(
      await fs.readFile(path.join(here, "fixtures", "recap-open.flow.yaml"), "utf8"),
    );
    const [only, ...rest] = expandFlowVariants(flow);
    expect(rest).toHaveLength(0);
    expect(only!.id).toBeNull();
    expect(only!.flow).toBe(flow);
    const driver = new RecordingDriver();
    const result = await runFlow(only!.flow, driver, {
      ...(only!.info ? { variant: only!.info } : {}),
    });
    return { driver, result };
  }

  it("takes the old screenshot path and runs the old driver calls", async () => {
    const { driver, result } = await runRecapOpen();
    expect(driver.calls).toEqual([
      "goto index.html",
      "waitLoad",
      "click #play-recap",
      "waitSelector #recap-sidebar",
      "screenshot docs/recap-open/screenshots/open-sidebar.png",
    ]);
    expect(result.steps.map((s) => s.screenshot)).toEqual([
      undefined,
      "docs/recap-open/screenshots/open-sidebar.png",
    ]);
  });

  it("serializes to the annotations.json bytes the engine wrote before, with no variant key", async () => {
    const { result } = await runRecapOpen();
    const bytes = JSON.stringify(result.annotations, null, 2) + "\n";
    expect(bytes).toBe(`{
  "schema": "docsxai/annotations@1",
  "flow": "recap-open",
  "annotations": [
    {
      "step": "open-sidebar",
      "selector": "#play-recap",
      "bounding_box": {
        "x": 10,
        "y": 20,
        "width": 30,
        "height": 40
      },
      "copy": "Click Play to open the Recap sidebar",
      "arrow_style": "top-right"
    }
  ]
}
`);
  });

  it("halts with the old message and the old halt-shot path", async () => {
    const flow = parseFlowFile(
      await fs.readFile(path.join(here, "fixtures", "recap-open.flow.yaml"), "utf8"),
    );
    const driver = new RecordingDriver();
    driver.failClicks.add("#play-recap");
    const error = (await runFlow(flow, driver).catch((e: unknown) => e)) as FlowExecutionError;
    expect(error.message).toBe(
      '[target is not visible (display:none / visibility:hidden / zero-sized)] step "open-sidebar" (click) failed at index.html: element is not visible: #play-recap (halt screenshot: docs/recap-open/halts/open-sidebar.png)',
    );
    expect(error.variant).toBeUndefined();
  });
});
