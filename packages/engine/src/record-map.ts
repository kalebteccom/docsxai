// Turns the events a recorder captured into flow steps and named locators. Pure: no browser, no
// file system. The design is docs/flow-recorder.md; this is its first build step. A locator is one
// canonical selector (no fallback lists), in the forms the flow-file reference documents: a test
// id attribute, or a tag with its visible text. Anything weaker is written but reported in `notes`
// so the author sees the gap.

/** What the recorder knows about the element an event hit. */
export interface RecordedTarget {
  /** Value of the `data-testid` attribute. */
  testId?: string;
  /** Lower-case tag name, for example `button`, `a` or `input`. */
  tag?: string;
  /** Accessible name, or the visible text when there is none. */
  name?: string;
  /** A short CSS path, used only when nothing steadier exists. */
  css?: string;
}

export type RecordedEvent =
  | { kind: "navigate"; url: string }
  | { kind: "click"; target: RecordedTarget }
  | { kind: "fill"; target: RecordedTarget; value: string; secret?: boolean }
  | { kind: "select"; target: RecordedTarget; value: string }
  | { kind: "check"; target: RecordedTarget }
  | { kind: "press"; key: string };

export interface MappedStep {
  id: string;
  action: "navigate" | "click" | "fill" | "select" | "check" | "press";
  /** `$name` of an entry in `locators`. */
  target?: string;
  value?: string;
  wait_for?: "load";
}

export interface MappedFlow {
  steps: MappedStep[];
  /** Locator name to selector. */
  locators: Record<string, string>;
  /** One line per gap the author should look at. */
  notes: string[];
}

const NAME_MAX = 40;
const TEXT_TAGS = new Set(["button", "a"]);
const SUFFIX: Record<string, string> = {
  button: "button",
  a: "link",
  input: "field",
  textarea: "field",
  select: "select",
};

const quote = (text: string): string => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/_+$/g, "");
  return s === "" ? "element" : s;
}

/** The selector for a target and whether it is steady enough to replay. Undefined when it says nothing. */
export function chooseLocator(
  t: RecordedTarget,
): { selector: string; steady: boolean } | undefined {
  if (t.testId) return { selector: `[data-testid="${quote(t.testId)}"]:visible`, steady: true };
  if (t.tag && TEXT_TAGS.has(t.tag) && t.name) {
    return { selector: `${t.tag}:has-text("${quote(t.name)}")`, steady: true };
  }
  if (t.css) return { selector: t.css, steady: false };
  return undefined;
}

function baseName(t: RecordedTarget): string {
  const word = t.testId ?? t.name ?? t.css ?? "element";
  const base = slug(word);
  const suffix = t.tag ? SUFFIX[t.tag] : undefined;
  return suffix && !base.endsWith(`_${suffix}`) && base !== suffix ? `${base}_${suffix}` : base;
}

export function mapEvents(events: readonly RecordedEvent[]): MappedFlow {
  const steps: MappedStep[] = [];
  const locators: Record<string, string> = {};
  const bySelector = new Map<string, string>();
  const stepIds = new Set<string>();
  const notes: string[] = [];

  const stepId = (action: string, hint: string): string => {
    const base = `${action}-${hint}`;
    let id = base;
    for (let n = 2; stepIds.has(id); n++) id = `${base}-${n}`;
    stepIds.add(id);
    return id;
  };

  const nameFor = (t: RecordedTarget): { ref: string; steady: boolean } | undefined => {
    const chosen = chooseLocator(t);
    if (!chosen) return undefined;
    let name = bySelector.get(chosen.selector);
    if (name === undefined) {
      const base = baseName(t);
      name = base;
      for (let n = 2; Object.hasOwn(locators, name); n++) name = `${base}_${n}`;
      locators[name] = chosen.selector;
      bySelector.set(chosen.selector, name);
    }
    return { ref: `$${name}`, steady: chosen.steady };
  };

  for (const event of events) {
    if (event.kind === "navigate") {
      steps.push({
        id: stepId("open", slug(event.url.replace(/^[a-z]+:\/\/[^/]+/i, "") || "home")),
        action: "navigate",
        value: event.url,
        wait_for: "load",
      });
      continue;
    }
    if (event.kind === "press") {
      steps.push({ id: stepId("press", slug(event.key)), action: "press", value: event.key });
      continue;
    }
    const named = nameFor(event.target);
    if (!named) {
      notes.push(`skipped a ${event.kind}: the element had no test id, text or CSS path`);
      continue;
    }
    const last = steps.at(-1);
    if (event.kind === "fill" && last?.action === "fill" && last.target === named.ref) {
      // Typing arrives as many events on one field; the last value is the one that matters.
      if (event.secret) {
        last.value = "";
        notes.push(`step ${last.id}: secret value left empty, supply one`);
      } else {
        last.value = event.value;
      }
      continue;
    }
    const step: MappedStep = {
      id: stepId(event.kind, named.ref.slice(1)),
      action: event.kind,
      target: named.ref,
    };
    if (event.kind === "fill" || event.kind === "select") {
      step.value = event.kind === "fill" && event.secret ? "" : event.value;
    }
    if (event.kind === "fill" && event.secret) {
      notes.push(`step ${step.id}: secret value left empty, supply one`);
    }
    if (!named.steady) {
      notes.push(`step ${step.id}: no stable locator, review ${locators[named.ref.slice(1)]}`);
    }
    steps.push(step);
  }
  return { steps, locators, notes };
}
