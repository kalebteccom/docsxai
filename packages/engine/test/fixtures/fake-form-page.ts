// A browserless `AuthPage`: drives the fixture HTML form servers over plain HTTP with the
// engine's own cookie jar. Lets the browser-driving strategies (ui-form, email-otp) run their
// full login choreography in unit tests without Chromium. Selector support is deliberately
// narrow — `#id` only — which is exactly what the fixture pages expose.

import { type AuthPage, type AuthPageOptions } from "../../src/auth/browser-session.js";
import { CookieJar, fetchCollectingCookies } from "../../src/auth/cookie-jar.js";
import { type StorageState } from "../../src/auth/types.js";

export interface FakeFormPage extends AuthPage {
  /** Ordered call log: `goto:<url>`, `fill:#id`, `click:#id`, `virtual-authenticator`, `close`. */
  readonly events: string[];
  readonly jar: CookieJar;
  currentUrl(): string;
  htmlBody(): string;
}

function idOf(selector: string): string {
  if (!selector.startsWith("#")) {
    throw new Error(`fake-form-page only supports #id selectors, got "${selector}"`);
  }
  return selector.slice(1);
}

export function makeFakeFormPage(opts: AuthPageOptions): FakeFormPage {
  const jar = new CookieJar();
  const events: string[] = [];
  let current = new URL(opts.baseURL);
  let html = "";
  let fields: Record<string, string> = {};

  const idPresent = (id: string) => html.includes(`id="${id}"`);
  const navigate = async (url: URL, init?: Parameters<typeof fetchCollectingCookies>[1]) => {
    const r = await fetchCollectingCookies(url, init ?? {}, { jar });
    current = new URL(r.url);
    html = r.body;
    fields = {};
  };

  return {
    events,
    jar,
    currentUrl: () => current.href,
    htmlBody: () => html,

    async goto(url) {
      events.push(`goto:${url}`);
      await navigate(new URL(url, opts.baseURL));
    },

    async fill(selector, value) {
      events.push(`fill:${selector}`);
      const id = idOf(selector);
      const name = html.match(new RegExp(`<input id="${id}" name="([^"]+)"`))?.[1];
      if (!name) throw new Error(`no input matching ${selector} on ${current.pathname}`);
      fields[name] = value;
    },

    async click(selector) {
      events.push(`click:${selector}`);
      const id = idOf(selector);
      if (!idPresent(id)) throw new Error(`no element matching ${selector} on ${current.pathname}`);
      // A button whose onclick removes an element simulates the overlay-dismiss pre-step.
      const dismissTarget = html.match(
        new RegExp(`<button id="${id}" onclick="document\\.getElementById\\('([^']+)'\\)\\.remove\\(\\)"`),
      )?.[1];
      if (dismissTarget) {
        html = html.replace(new RegExp(`<div id="${dismissTarget}"[\\s\\S]*?</div>`), "");
        return;
      }
      // Anything else is blocked while a full-page overlay is up — like a real pointer would be.
      if (idPresent("overlay")) {
        throw new Error(`click on ${selector} intercepted by the #overlay element`);
      }
      if (html.includes(`<button id="${id}" type="submit"`)) {
        const action = html.match(/<form method="post" action="([^"]+)">/)?.[1];
        if (!action) throw new Error(`no post form on ${current.pathname} for ${selector}`);
        await navigate(new URL(action, current), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(fields).toString(),
        });
      }
    },

    async waitForSelector(selector, _o) {
      if (!idPresent(idOf(selector))) {
        throw new Error(`timed out waiting for ${selector} on ${current.pathname}`);
      }
    },

    async waitForUrl(pattern, _o) {
      if (!pattern.test(current.href)) {
        throw new Error(`timed out waiting for url ${pattern} (at ${current.pathname})`);
      }
    },

    async enableVirtualAuthenticator() {
      events.push("virtual-authenticator");
    },

    async storageState(): Promise<StorageState> {
      return jar.toStorageState();
    },

    async close() {
      events.push("close");
    },
  };
}
