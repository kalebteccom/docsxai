// `pull` writes the names a backend response carries, so every name is checked before the first
// write: a flow file is `<flow name>.flow.yaml`, an annotations file or a screenshot sits under
// `docs/<flow>[/<variant>]/`. One bad name refuses the whole response.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafePackNames,
  UnsafePackNameError,
  writeDocPack,
  type DocPackPayloads,
} from "../src/doc-pack-io.js";

let ws = "";
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pull-names-"));
  await fs.writeFile(path.join(ws, ".docsxai.json"), '{"schema":"docsxai/workspace@1"}', "utf8");
});
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

const flows = (...names: string[]): Partial<DocPackPayloads> => ({
  flows: { schema: "docsxai/flows@1", files: Object.fromEntries(names.map((n) => [n, "x"])) },
});
const annotations = (...names: string[]): Partial<DocPackPayloads> => ({
  annotations: {
    schema: "docsxai/annotations-bundle@1",
    files: Object.fromEntries(names.map((n) => [n, {}])),
  },
});
const screenshots = (...names: string[]): Partial<DocPackPayloads> => ({
  screenshots: {
    schema: "docsxai/screenshots@2",
    files: Object.fromEntries(names.map((n) => [n, { sha256: "0".repeat(64), bytes: 1 }])),
  },
});

describe("assertSafePackNames", () => {
  it.each([
    flows("board.flow.yaml", "Board_1.v2.flow.yaml"),
    annotations("tour/annotations.json", "tour/en-US.dark/annotations.json"),
    screenshots("tour/screenshots/s1.png", "tour/es-ES.light/screenshots/Step_2.JPG"),
    {},
  ])("accepts the names a workspace produces: %j", (payloads) => {
    expect(() => assertSafePackNames(payloads)).not.toThrow();
  });

  it.each([
    "../.docsxai.json",
    "../auth/strategy.yaml",
    "../x.flow.yaml",
    "a/b.flow.yaml",
    "a\\b.flow.yaml",
    "/etc/x.flow.yaml",
    ".hidden.flow.yaml",
    "board.yaml",
    "board.flow.yml",
    ".flow.yaml",
    "con.flow.yaml",
    "board..flow.yaml",
    `${"x".repeat(65)}.flow.yaml`,
  ])("refuses the flow file name %j", (name) => {
    expect(() => assertSafePackNames(flows(name))).toThrow(UnsafePackNameError);
  });

  it.each([
    "../annotations.json",
    "../../.docsxai.json",
    "tour/../annotations.json",
    "annotations.json",
    "tour/other.json",
    "tour/a/b/annotations.json",
    "/abs/annotations.json",
    ".git/annotations.json",
    "tour/.hidden/annotations.json",
    "tour/en-US./annotations.json",
    "nul/annotations.json",
  ])("refuses the annotations name %j", (name) => {
    expect(() => assertSafePackNames(annotations(name))).toThrow(UnsafePackNameError);
  });

  it.each([
    "../screenshots/s.png",
    "tour/screenshots/../../../x.png",
    "tour/screenshots/s.txt",
    "tour/shots/s.png",
    "screenshots/s.png",
    "tour/screenshots/sub/s.png",
    "tour/screenshots/.s.png",
    "tour/screenshots/",
  ])("refuses the screenshot name %j", (name) => {
    expect(() => assertSafePackNames(screenshots(name))).toThrow(UnsafePackNameError);
  });

  it("refuses two flow files that differ only by case", () => {
    expect(() => assertSafePackNames(flows("Board.flow.yaml", "board.flow.yaml"))).toThrow(
      /differ only by case/,
    );
  });

  it.each([
    "tour/con/annotations.json",
    "tour/NUL.dark/annotations.json",
    "tour/lpt1/annotations.json",
    "tour/com9.v2/annotations.json",
    "tour/x./annotations.json",
  ])("refuses the Windows-hostile variant segment in %j", (name) => {
    expect(() => assertSafePackNames(annotations(name))).toThrow(UnsafePackNameError);
    expect(() =>
      assertSafePackNames(screenshots(name.replace("annotations.json", "screenshots/s.png"))),
    ).toThrow(UnsafePackNameError);
  });

  it.each([
    "tour/annotations.json/annotations.json",
    "tour/screenshots/annotations.json",
    "tour/Screenshots/annotations.json",
    "tour/ANNOTATIONS.JSON/annotations.json",
  ])("refuses the reserved variant directory in %j", (name) => {
    expect(() => assertSafePackNames(annotations(name))).toThrow(UnsafePackNameError);
  });

  it.each([
    "tour/screenshots/screenshots/s.png",
    "tour/annotations.json/screenshots/s.png",
    "tour/SCREENSHOTS/screenshots/s.png",
  ])("refuses the reserved variant directory in the screenshot path %j", (name) => {
    expect(() => assertSafePackNames(screenshots(name))).toThrow(UnsafePackNameError);
  });

  it("keeps variants that only start like a device name", () => {
    expect(() =>
      assertSafePackNames(
        annotations("tour/console/annotations.json", "tour/com10/annotations.json"),
      ),
    ).not.toThrow();
  });

  it.each([
    "tour/screenshots/con.png",
    "tour/screenshots/NUL.webp",
    "tour/screenshots/aux.v2.png",
    "tour/screenshots/lpt3.jpg",
    "tour/screenshots/s..png",
    "tour/screenshots/s..2.png",
  ])("refuses the Windows-hostile screenshot name %j", (name) => {
    expect(() => assertSafePackNames(screenshots(name))).toThrow(UnsafePackNameError);
  });

  it("keeps screenshot stems that only start like a device name", () => {
    expect(() =>
      assertSafePackNames(
        screenshots("tour/screenshots/console.png", "tour/screenshots/conclusion.png"),
      ),
    ).not.toThrow();
  });

  it("refuses two annotation paths that differ only by case", () => {
    expect(() =>
      assertSafePackNames(annotations("Tour/annotations.json", "tour/annotations.json")),
    ).toThrow(/annotations .* differ only by case/);
    expect(() =>
      assertSafePackNames(
        annotations("tour/En.dark/annotations.json", "tour/en.dark/annotations.json"),
      ),
    ).toThrow(/differ only by case/);
  });

  it("refuses two screenshot paths that differ only by case", () => {
    expect(() =>
      assertSafePackNames(screenshots("tour/screenshots/A.png", "tour/screenshots/a.png")),
    ).toThrow(/screenshots .* differ only by case/);
  });

  it("refuses an annotations directory and a screenshots directory that differ only by case", () => {
    expect(() =>
      assertSafePackNames({
        ...annotations("Tour/annotations.json"),
        ...screenshots("tour/screenshots/s.png"),
      }),
    ).toThrow(/output directories .* differ only by case/);
  });

  it("accepts the same directory named the same way by both artifacts", () => {
    expect(() =>
      assertSafePackNames({
        ...annotations("tour/annotations.json", "tour/en.dark/annotations.json"),
        ...screenshots(
          "tour/screenshots/a.png",
          "tour/screenshots/b.png",
          "tour/en.dark/screenshots/a.png",
        ),
      }),
    ).not.toThrow();
  });

  it("names the artifact and shortens a long name in the message", () => {
    const long = `${"a".repeat(200)}/x.flow.yaml`;
    const message = (() => {
      try {
        assertSafePackNames(flows(long));
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();
    expect(message).toContain("flows file name");
    expect(message).toContain("nothing written");
    expect(message.length).toBeLessThan(300);
  });
});

describe("writeDocPack with a hostile response", () => {
  it("writes nothing when one name in the response is bad", async () => {
    await expect(
      writeDocPack(ws, {
        ...flows("good.flow.yaml", "../.docsxai.json"),
        ...annotations("tour/annotations.json"),
      }),
    ).rejects.toThrow(UnsafePackNameError);
    expect(await fs.readdir(ws)).toEqual([".docsxai.json"]);
    expect(await fs.readFile(path.join(ws, ".docsxai.json"), "utf8")).toBe(
      '{"schema":"docsxai/workspace@1"}',
    );
  });

  it("does not overwrite auth/strategy.yaml through a flow name", async () => {
    await fs.mkdir(path.join(ws, "auth"), { recursive: true });
    await fs.writeFile(path.join(ws, "auth", "strategy.yaml"), "original", "utf8");
    await expect(writeDocPack(ws, flows("../auth/strategy.yaml"))).rejects.toThrow(
      UnsafePackNameError,
    );
    expect(await fs.readFile(path.join(ws, "auth", "strategy.yaml"), "utf8")).toBe("original");
  });

  it("refuses a bad screenshot name even when its bytes were not fetched", async () => {
    await expect(writeDocPack(ws, screenshots("../../x.png"), {})).rejects.toThrow(
      UnsafePackNameError,
    );
  });

  it("still writes a response made of good names", async () => {
    const r = await writeDocPack(ws, {
      ...flows("tour.flow.yaml"),
      ...annotations("tour/en-US.dark/annotations.json"),
    });
    expect(r.filesWritten).toBe(2);
    expect(await fs.readFile(path.join(ws, "flows", "tour.flow.yaml"), "utf8")).toBe("x");
    expect(
      await fs.readFile(path.join(ws, "docs", "tour", "en-US.dark", "annotations.json"), "utf8"),
    ).toBe("{}\n");
  });
});
