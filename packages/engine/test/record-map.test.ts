import { describe, expect, it } from "vitest";
import { chooseLocator, mapEvents, type RecordedEvent } from "../src/record-map.js";

describe("chooseLocator", () => {
  it("prefers a test id, then tag text, then a CSS path", () => {
    expect(
      chooseLocator({ testId: "save", tag: "button", name: "Save", css: "main > button" }),
    ).toEqual({
      selector: '[data-testid="save"]:visible',
      steady: true,
    });
    expect(chooseLocator({ tag: "button", name: "Save" })).toEqual({
      selector: 'button:has-text("Save")',
      steady: true,
    });
    expect(chooseLocator({ css: "main > div.card" })).toEqual({
      selector: "main > div.card",
      steady: false,
    });
  });
  it("escapes quotes and says nothing for an empty target", () => {
    expect(chooseLocator({ tag: "a", name: 'Say "hi"' })?.selector).toBe(
      'a:has-text("Say \\"hi\\"")',
    );
    expect(chooseLocator({})).toBeUndefined();
    expect(chooseLocator({ tag: "input", name: "Email" })).toBeUndefined();
  });
});

describe("mapEvents", () => {
  const events: RecordedEvent[] = [
    { kind: "navigate", url: "https://app.example/settings/team" },
    { kind: "click", target: { tag: "button", name: "Invite user", testId: "invite-user" } },
    { kind: "fill", target: { tag: "input", testId: "email" }, value: "s" },
    { kind: "fill", target: { tag: "input", testId: "email" }, value: "sam@example.com" },
    { kind: "press", key: "Enter" },
  ];

  it("names locators, collapses typing and keeps step order", () => {
    const flow = mapEvents(events);
    expect(flow.locators).toEqual({
      invite_user_button: '[data-testid="invite-user"]:visible',
      email_field: '[data-testid="email"]:visible',
    });
    expect(flow.steps).toEqual([
      {
        id: "open-settings_team",
        action: "navigate",
        value: "https://app.example/settings/team",
        wait_for: "load",
      },
      { id: "click-invite_user_button", action: "click", target: "$invite_user_button" },
      { id: "fill-email_field", action: "fill", target: "$email_field", value: "sam@example.com" },
      { id: "press-enter", action: "press", value: "Enter" },
    ]);
    expect(flow.notes).toEqual([]);
  });

  it("reuses a locator for the same selector and numbers a name clash", () => {
    const flow = mapEvents([
      { kind: "click", target: { tag: "button", name: "Save" } },
      { kind: "click", target: { tag: "button", name: "Save" } },
      { kind: "click", target: { tag: "a", name: "Save" } },
      { kind: "click", target: { tag: "button", testId: "save" } },
    ]);
    expect(Object.keys(flow.locators)).toEqual(["save_button", "save_link", "save_button_2"]);
    expect(flow.steps.map((s) => s.id)).toEqual([
      "click-save_button",
      "click-save_button-2",
      "click-save_link",
      "click-save_button_2",
    ]);
  });

  it("never writes a secret value and says so", () => {
    const flow = mapEvents([
      {
        kind: "fill",
        target: { tag: "input", testId: "password" },
        value: "hunter2",
        secret: true,
      },
    ]);
    expect(flow.steps[0]).toMatchObject({ action: "fill", value: "" });
    expect(JSON.stringify(flow)).not.toContain("hunter2");
    expect(flow.notes).toEqual(["step fill-password_field: secret value left empty, supply one"]);
  });

  it("writes a weak locator and reports it, and skips a target with nothing to go on", () => {
    const flow = mapEvents([
      { kind: "click", target: { css: "main > div.card" } },
      { kind: "click", target: {} },
    ]);
    expect(flow.steps).toHaveLength(1);
    expect(flow.notes).toEqual([
      "step click-main_div_card: no stable locator, review main > div.card",
      "skipped a click: the element had no test id, text or CSS path",
    ]);
  });
});
