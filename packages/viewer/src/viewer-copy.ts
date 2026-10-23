// Copy-to-clipboard for the ids a viewer page shows (flow, step and variant ids, the viewer build,
// commands to run). One table of copy and timing shared by the markup (viewer-markup.ts), the
// runtime (overlay-runtime.ts) and the tests. No DOM access: the runtime owns the clipboard calls.
//
// A copy button holds three labels stacked in one grid cell, so its width is that of the longest
// one and the label swap never moves the page. The button's accessible name stays "Copy <what>
// <value>" in every state; the state change is spoken through the polite live region (#sd-live).

/** How long the button shows "Copied" before it goes back to "Copy". */
export const COPIED_MS = 1500;

/** How long "Press Ctrl+C" stays when the clipboard is unavailable (the text stays selected). */
export const FALLBACK_MS = 5000;

export const COPY_LABELS = {
  idle: "Copy",
  done: "Copied",
  fallback: "Press Ctrl+C",
} as const;

export type CopyState = keyof typeof COPY_LABELS;

const escText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The kinds of value that get a button, for the accessible name ("Copy step id login"). */
export type CopyKind = "flow id" | "step id" | "viewer build" | "command";

/** A button that copies `value`; the runtime finds it by `data-copy`. */
export function copyButton(value: string, kind: CopyKind): string {
  const label = (state: CopyState, hidden: boolean) =>
    `<span class="sd-copy-label sd-copy-${state}"${hidden ? ' aria-hidden="true"' : ""}>${COPY_LABELS[state]}</span>`;
  return (
    `<button type="button" class="sd-copy" data-copy="${escText(value)}" data-kind="${kind}" data-state="idle" ` +
    `aria-label="Copy ${kind} ${escText(value)}">` +
    `${label("idle", true)}${label("done", true)}${label("fallback", true)}</button>`
  );
}

/** What the live region says after a copy. */
export function copyAnnouncement(state: CopyState, kind: string, value: string): string {
  if (state === "done") return `Copied ${kind} ${value} to the clipboard.`;
  if (state === "fallback")
    return `The clipboard is not available here. ${kind} ${value} is selected, press Ctrl+C (Cmd+C on a Mac) to copy it.`;
  return "";
}
