// Which selectors a flow's `hide` / `show` steps have hidden at each step. Pure and static: it
// reads the step list only, so `lint` and `diagnose` can say "this step reaches an element an
// earlier step hid" without a browser. A `show` with a target lifts only the selector a `hide`
// used (the same resolved string); a `show` with no target lifts everything.

import type { FlowFile } from "./doc-pack.js";

export interface HiddenAt {
  /** Resolved selectors hidden when the step's action starts. */
  before: ReadonlySet<string>;
  /** Resolved selectors hidden once the step's action has run (what its screenshot sees). */
  after: ReadonlySet<string>;
}

/** One entry per step, in step order. `resolve` turns a `target` (ref or inline) into a selector. */
export function hiddenAtEachStep(flow: FlowFile, resolve: (target: string) => string): HiddenAt[] {
  const hidden = new Set<string>();
  return flow.steps.map((step) => {
    const before = new Set(hidden);
    if (step.action === "hide" && step.target) hidden.add(resolve(step.target));
    if (step.action === "show") {
      if (step.target) hidden.delete(resolve(step.target));
      else hidden.clear();
    }
    return { before, after: new Set(hidden) };
  });
}
