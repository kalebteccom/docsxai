// Flow → Playwright-test export — golden specs (every action/wait/success variant, extends,
// optional steps, environment), determinism, a syntax-level transpile check on every golden
// (ts.transpileModule — no type resolution), and the CLI edge. Pure string transform: unit suite.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportFlowAsPlaywrightTest,
  exportWorkspaceFlowsAsPlaywrightTests,
} from "../src/export/playwright-test.js";
import { parseFlowFile } from "../src/flow-file.js";
import { main } from "../src/cli.js";

/** Every generated spec in this suite lands here; one test transpile-checks them all. */
const generatedSpecs: string[] = [];

function generate(yaml: string, flowFileName: string): string {
  const spec = exportFlowAsPlaywrightTest(parseFlowFile(yaml), { flowFileName });
  generatedSpecs.push(spec);
  return spec;
}

const KITCHEN_SINK = `name: Checkout
environment:
  clock: "2024-05-01T09:00:00Z"
  locale: en-GB
  timezone: Europe/Amsterdam
  viewport: desktop
  color_scheme: dark
  reduced_motion: true
locators:
  pay: "[data-testid=pay]"
  cart: "[data-testid=cart]"
  qty: "[data-testid=qty]"
  country: "[data-testid=country]"
  terms: "[data-testid=terms]"
  news: "[data-testid=news]"
  search: "[data-testid=search]"
  receipt: "[data-testid=receipt]"
steps:
  - id: open
    action: navigate
    value: /checkout
    wait_for: network_idle
    success: { url_matches: "/checkout$" }
  - id: fill-qty
    action: fill
    target: $qty
    value: "2"
    wait_for: { selector: $cart, timeout_ms: 5000 }
  - id: choose-country
    action: select
    target: $country
    value: NL
  - id: accept-terms
    action: check
    target: $terms
  - id: no-news
    action: uncheck
    target: $news
  - id: peek-cart
    action: hover
    target: $cart
    wait_for: element_stable
  - id: search
    action: press
    target: $search
    value: Enter
    success: { text_contains: { selector: $cart, text: 2 items } }
  - id: add-receipt
    action: upload
    target: $receipt
    value: ./fixtures/receipt.pdf
  - id: dismiss-banner
    action: click
    target: ".cookie-banner button"
    optional: true
    success: { hidden: ".cookie-banner" }
  - id: pay
    action: click
    target: $pay
    wait_for: load
    success: { visible: $cart }
  - id: settle
    action: wait
    wait_for: { timeout_ms: 250 }
`;

const KITCHEN_SINK_SPEC = `// generated from checkout.flow.yaml — regenerate, don't hand-edit
import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 900 },
  locale: "en-GB",
  timezoneId: "Europe/Amsterdam",
  colorScheme: "dark",
  reducedMotion: "reduce",
});

test("Checkout", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2024-05-01T09:00:00Z"));

  const pay = page.locator("[data-testid=pay]");
  const cart = page.locator("[data-testid=cart]");
  const qty = page.locator("[data-testid=qty]");
  const country = page.locator("[data-testid=country]");
  const terms = page.locator("[data-testid=terms]");
  const news = page.locator("[data-testid=news]");
  const search = page.locator("[data-testid=search]");
  const receipt = page.locator("[data-testid=receipt]");

  // step: open (navigate)
  await page.goto("/checkout");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(new RegExp("/checkout$"));

  // step: fill-qty (fill)
  await qty.fill("2");
  await cart.waitFor({ state: "visible", timeout: 5000 });

  // step: choose-country (select)
  await country.selectOption("NL");

  // step: accept-terms (check)
  await terms.check();

  // step: no-news (uncheck)
  await news.uncheck();

  // step: peek-cart (hover)
  await cart.hover();
  await cart.waitFor({ state: "visible" }); // element_stable

  // step: search (press)
  await search.press("Enter");
  await expect(cart).toContainText("2 items");

  // step: add-receipt (upload)
  await receipt.setInputFiles("./fixtures/receipt.pdf");

  // step: dismiss-banner (click, optional)
  try {
    await page.locator(".cookie-banner button").click();
    await expect(page.locator(".cookie-banner")).toBeHidden();
  } catch {
    // optional step — conditionally-present UI; a miss is tolerated
  }

  // step: pay (click)
  await pay.click();
  await page.waitForLoadState("load");
  await expect(cart).toBeVisible();

  // step: settle (wait)
  await page.waitForTimeout(250);
});
`;

describe("exportFlowAsPlaywrightTest", () => {
  it("renders the kitchen-sink golden (every action/wait/success variant + environment + optional)", () => {
    expect(generate(KITCHEN_SINK, "checkout")).toBe(KITCHEN_SINK_SPEC);
  });

  it("is deterministic (same flow → byte-identical spec)", () => {
    expect(generate(KITCHEN_SINK, "checkout")).toBe(generate(KITCHEN_SINK, "checkout"));
  });

  it("press without a target uses page.keyboard; minimal flow has no test.use/clock", () => {
    const spec = generate(
      `name: shortcuts
steps:
  - id: save
    action: press
    value: Control+s
`,
      "shortcuts",
    );
    expect(spec).toBe(`// generated from shortcuts.flow.yaml — regenerate, don't hand-edit
import { expect, test } from "@playwright/test";

test("shortcuts", async ({ page }) => {
  // step: save (press)
  await page.keyboard.press("Control+s");
});
`);
  });

  it("sanitizes locator names that collide with JS identifiers", () => {
    const spec = generate(
      `name: tricky
locators:
  class: ".a"
  page: ".b"
steps:
  - id: s1
    action: click
    target: $class
  - id: s2
    action: hover
    target: $page
`,
      "tricky",
    );
    expect(spec).toContain(`const class_ = page.locator(".a");`);
    expect(spec).toContain(`const page_ = page.locator(".b");`);
    expect(spec).toContain(`await class_.click();`);
    expect(spec).toContain(`await page_.hover();`);
  });

  it("an unmappable step degrades to a comment (never invalid code)", () => {
    const spec = generate(
      `name: sparse
steps:
  - id: s1
    action: click
`,
      "sparse",
    );
    expect(spec).toContain(`// step "s1": click without a target — nothing to emit`);
  });

  it("rejects flows with an unresolved extends chain", () => {
    const flow = parseFlowFile(`name: child
extends: base
steps:
  - id: s1
    action: navigate
    value: /
`);
    expect(() => exportFlowAsPlaywrightTest(flow)).toThrow(/resolve `extends`/);
  });
});

// ---------------------------------------------------------------------------
// Workspace export (extends resolution) + CLI
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const BASE_FLOW = `name: base
environment:
  viewport: { width: 800, height: 600 }
locators:
  home: "[data-testid=home]"
steps:
  - id: go-home
    action: navigate
    value: /
  - id: open-menu
    action: click
    target: $home
`;

const CHILD_FLOW = `name: child
extends: base
environment:
  locale: nl-NL
locators:
  save: "[data-testid=save]"
steps:
  - id: save-it
    action: click
    target: $save
    success: { visible: $home }
`;

async function makeWorkspace(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-pw-export-"));
  tempDirs.push(ws);
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.writeFile(path.join(ws, "flows", "base.flow.yaml"), BASE_FLOW, "utf8");
  await fs.writeFile(path.join(ws, "flows", "child.flow.yaml"), CHILD_FLOW, "utf8");
  return ws;
}

describe("exportWorkspaceFlowsAsPlaywrightTests", () => {
  it("resolves extends: the child spec carries merged environment, locators, and steps", async () => {
    const ws = await makeWorkspace();
    const specs = await exportWorkspaceFlowsAsPlaywrightTests({ workspaceDir: ws });
    expect(specs.map((s) => [s.flowName, s.fileName])).toEqual([
      ["base", "base.spec.ts"],
      ["child", "child.spec.ts"],
    ]);
    const child = specs[1]!.content;
    generatedSpecs.push(...specs.map((s) => s.content));
    expect(child).toBe(`// generated from child.flow.yaml — regenerate, don't hand-edit
import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 800, height: 600 },
  locale: "nl-NL",
});

test("child", async ({ page }) => {
  const home = page.locator("[data-testid=home]");
  const save = page.locator("[data-testid=save]");

  // step: go-home (navigate)
  await page.goto("/");

  // step: open-menu (click)
  await home.click();

  // step: save-it (click)
  await save.click();
  await expect(home).toBeVisible();
});
`);
  });

  it("throws on unknown flow names", async () => {
    const ws = await makeWorkspace();
    await expect(
      exportWorkspaceFlowsAsPlaywrightTests({ workspaceDir: ws, flows: ["nope"] }),
    ).rejects.toThrow(/no flow named "nope"/);
  });
});

describe("export playwright CLI", () => {
  let out = "";
  let err = "";
  beforeEach(() => {
    out = "";
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one spec per flow to <ws>/.export/tests/ by default", async () => {
    const ws = await makeWorkspace();
    expect(await main(["export", "playwright", ws])).toBe(0);
    expect(out).toMatch(/export playwright: wrote 2 specs/);
    const outDir = path.join(ws, ".export", "tests");
    expect((await fs.readdir(outDir)).sort()).toEqual(["base.spec.ts", "child.spec.ts"]);
    generatedSpecs.push(await fs.readFile(path.join(outDir, "child.spec.ts"), "utf8"));
  });

  it("--flow restricts; --out redirects", async () => {
    const ws = await makeWorkspace();
    const outDir = path.join(ws, "exported-tests");
    expect(await main(["export", "playwright", ws, "--flow", "child", "--out", outDir])).toBe(0);
    expect(await fs.readdir(outDir)).toEqual(["child.spec.ts"]);
  });

  it("argument errors: missing workspace 2, unknown flow 1, unknown format 2", async () => {
    expect(await main(["export", "playwright"])).toBe(2);
    const ws = await makeWorkspace();
    expect(await main(["export", "playwright", ws, "--flow", "nope"])).toBe(1);
    expect(err).toMatch(/no flow named "nope"/);
    expect(await main(["export", "bogus", ws])).toBe(2);
    expect(err).toMatch(/supported: adf, playwright/);
  });
});

// ---------------------------------------------------------------------------
// Transpile check — every golden produced above must be valid TS syntax
// ---------------------------------------------------------------------------

describe("generated specs are syntactically valid TypeScript", () => {
  it("ts.transpileModule reports zero diagnostics for every generated spec", () => {
    expect(generatedSpecs.length).toBeGreaterThanOrEqual(7);
    for (const spec of generatedSpecs) {
      const result = ts.transpileModule(spec, {
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      expect(result.diagnostics ?? []).toEqual([]);
    }
  });
});
