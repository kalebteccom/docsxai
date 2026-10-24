// Copy-to-clipboard for the ids a viewer page shows (flow, step and variant ids, the viewer build,
// commands to run). One table of copy and timing shared by the markup (viewer-markup.ts), the
// runtime (overlay-runtime.ts) and the tests. No DOM access: the runtime owns the clipboard calls.
// The label text comes from ui-strings.ts, in the page language.
//
// A copy button holds three labels stacked in one grid cell, so its width is that of the longest
// one and the label swap never moves the page. The button's accessible name stays "Copy <what>
// <value>" in every state; the state change is spoken through the polite live region (#sd-live).

import { fmt, uiStrings, type CopyKind, type UiStrings } from "./ui-strings.js";

export type { CopyKind };

/** How long the button shows "Copied" before it goes back to "Copy". */
export const COPIED_MS = 1500;

/** How long "Press Ctrl+C" stays when the clipboard is unavailable (the text stays selected). */
export const FALLBACK_MS = 5000;

/** The English labels; a page in another language takes them from its `UiStrings`. */
export const COPY_LABELS = {
  idle: "Copy",
  done: "Copied",
  fallback: "Press Ctrl+C",
} as const;

export type CopyState = keyof typeof COPY_LABELS;

const escText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A button that copies `value`; the runtime finds it by `data-copy`. `kind` is the English phrase
 * ("step id"); the accessible name and `data-kind` carry it in the page language.
 */
export function copyButton(value: string, kind: CopyKind, ui: UiStrings = uiStrings()): string {
  const label = (state: CopyState) =>
    `<span class="sd-copy-label sd-copy-${state}" aria-hidden="true">${ui.copy[state]}</span>`;
  const shown = ui.kinds[kind];
  return (
    `<button type="button" class="sd-copy" data-copy="${escText(value)}" data-kind="${shown}" data-state="idle" ` +
    `aria-label="${fmt(ui.copy.aria, { kind: shown, value: escText(value) })}">` +
    `${label("idle")}${label("done")}${label("fallback")}</button>`
  );
}

/** What the live region says after a copy; `kind` is already in the page language. */
export function copyAnnouncement(
  state: CopyState,
  kind: string,
  value: string,
  ui: UiStrings = uiStrings(),
): string {
  if (state === "done") return fmt(ui.copy.announceDone, { kind, value });
  if (state === "fallback") return fmt(ui.copy.announceFallback, { kind, value });
  return "";
}
