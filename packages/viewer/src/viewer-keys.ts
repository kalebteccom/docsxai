// Keyboard model for the interactive viewer, as pure functions. overlay-runtime.ts wires them to
// the DOM; viewer-markup.ts renders the shortcut list from SHORTCUTS so the documented keys and
// the handled keys come from one table. No DOM access here, so tests run without a browser.

export type StepMove = "next" | "prev" | "first" | "last";

export type ViewerAction =
  { kind: "step"; move: StepMove } | { kind: "flow"; move: "next" | "prev" } | { kind: "dismiss" };

export interface Shortcut {
  /** `KeyboardEvent.key` values that trigger the action. */
  keys: readonly string[];
  /** The keys as the shortcut list shows them, e.g. `["→", "j"]`. */
  display: readonly string[];
  description: string;
  action: ViewerAction;
  /** Flow pages only (the index has no flows to step between and no call-outs). */
  flowPageOnly?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: ["ArrowRight", "j"],
    display: ["→", "j"],
    description: "Next step",
    action: { kind: "step", move: "next" },
  },
  {
    keys: ["ArrowLeft", "k"],
    display: ["←", "k"],
    description: "Previous step",
    action: { kind: "step", move: "prev" },
  },
  {
    keys: ["Home"],
    display: ["Home"],
    description: "First step",
    action: { kind: "step", move: "first" },
  },
  {
    keys: ["End"],
    display: ["End"],
    description: "Last step",
    action: { kind: "step", move: "last" },
  },
  {
    keys: ["]"],
    display: ["]"],
    description: "Next flow",
    action: { kind: "flow", move: "next" },
    flowPageOnly: true,
  },
  {
    keys: ["["],
    display: ["["],
    description: "Previous flow",
    action: { kind: "flow", move: "prev" },
    flowPageOnly: true,
  },
  {
    keys: ["Escape"],
    display: ["Esc"],
    description: "Hide the open call-out",
    action: { kind: "dismiss" },
    flowPageOnly: true,
  },
];

export interface KeyInput {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** True when focus is in a text field, select or contenteditable, where keys belong to the field. */
  editable?: boolean;
}

/**
 * The viewer action for a key press, or null to leave the event to the browser. Modified keys
 * (Alt+← is browser Back, Shift+→ extends a selection) and keys typed into a field pass through.
 * Tab is never handled, so focus can always leave any element.
 */
export function keyAction(e: KeyInput): ViewerAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === "Escape") return { kind: "dismiss" };
  if (e.editable || e.shiftKey) return null;
  for (const s of SHORTCUTS) if (s.keys.includes(e.key)) return s.action;
  return null;
}

/**
 * Index of the step to move to. `current` is -1 when no step is current yet, so "next" and
 * "prev" both start at the first step. Moves stop at the ends; -1 when there are no steps.
 */
export function targetIndex(current: number, count: number, move: StepMove): number {
  if (count <= 0) return -1;
  const last = count - 1;
  if (move === "first") return 0;
  if (move === "last") return last;
  if (current < 0 || current > last) return 0;
  return move === "next" ? Math.min(current + 1, last) : Math.max(current - 1, 0);
}

/**
 * The step the reader is on when focus is not inside one: the first whose bottom edge is below
 * the top of the viewport. `bottoms` are viewport-relative, in document order.
 */
export function stepInView(bottoms: readonly number[]): number {
  return bottoms.findIndex((b) => b > 0);
}

/** Text for the live region after a step change. */
export function stepAnnouncement(index: number, count: number, title: string): string {
  return `Step ${index + 1} of ${count}: ${title}`;
}

/** True for a focus target whose keys belong to it (text fields, select, contenteditable). */
export function isEditableTarget(tagName: string, type: string | null, editable: boolean): boolean {
  if (editable) return true;
  const tag = tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const t = (type ?? "text").toLowerCase();
  return !["button", "checkbox", "radio", "submit", "reset", "image", "range", "color"].includes(t);
}
