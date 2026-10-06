import { describe, expect, it } from "vitest";
import { assertGuarded, guardPack, scanText } from "../src/pack-guards.js";
import { SCREENS_PACK_SCHEMA, type ScreensPack } from "../src/pack-schema.js";

function packWith(parts: {
  title?: string;
  caption?: string;
  alt?: string;
  copy?: string;
}): ScreensPack {
  return {
    schema: SCREENS_PACK_SCHEMA,
    flows: {
      f: {
        ...(parts.title ? { title: { en: parts.title } } : {}),
        steps: {
          s: {
            ...(parts.caption ? { caption: { en: parts.caption } } : {}),
            alt: { en: parts.alt ?? "A page" },
            variants: {
              "en.light.390": {
                src: "/screens/f/s.0123abcd.png",
                width: 1,
                height: 1,
                bytes: 1,
                callouts: [
                  { index: 1, copy: "Fine" },
                  { index: 2, copy: parts.copy ?? "Also fine" },
                ],
              },
            },
          },
        },
      },
    },
  };
}

describe("scanText", () => {
  it.each([
    ["http://localhost:3000/mcp", "loopback host (localhost)"],
    ["Open LOCALHOST and sign in", "loopback host (localhost)"],
    ["admin.localhost", "loopback host (localhost)"],
    ["Serves http://127.0.0.1:3100/mcp", "loopback address (127.x.x.x)"],
    ["127.1.2.3", "loopback address (127.x.x.x)"],
    ["http://[::1]:8080/", "loopback address (::1)"],
    ["bind to ::1", "loopback address (::1)"],
    ["listens on 0.0.0.0", "unspecified address (0.0.0.0)"],
  ])("flags %j as %s", (text, rule) => {
    expect(scanText(text)).toEqual([rule]);
  });

  it.each([
    ["-----BEGIN RSA PRIVATE KEY-----", "private key block"],
    ["-----BEGIN PRIVATE KEY-----", "private key block"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk",
      "JSON web token",
    ],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", "bearer token"],
    ["sk-abcdefghijklmnopqrstuvwx", "API key (sk-)"],
    [`ghp_${"a1B2".repeat(9)}`, "GitHub token"],
    ["AKIAIOSFODNN7EXAMPLE", "AWS access key id"],
    [`AIza${"x".repeat(35)}`, "Google API key"],
    ["xoxb-1234567890-abcdefghij", "Slack token"],
    ["Write to jane.doe@company.com", "email address"],
    ["user+tag@mail.company.co.uk.", "email address"],
    ["you@example.com.evil.io", "email address"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization header"],
    ["authorization: Token abcdefgh12345678", "Authorization header"],
    ["Authorization: abcdef0123456789abcdef", "Authorization header"],
    ["Server at 10.0.0.1", "private network address (10.x.x.x)"],
    ["Open 10.255.3.40.", "private network address (10.x.x.x)"],
    ["172.16.5.4", "private network address (172.16-31.x.x)"],
    ["host 172.31.255.255:8080", "private network address (172.16-31.x.x)"],
    ["http://192.168.1.20/admin", "private network address (192.168.x.x)"],
    ["169.254.169.254", "link-local address (169.254.x.x)"],
    ["https://api.company.io/v1/items?token=abcdef123456", "token in URL query"],
    ["https://x.io/a?page=2&key=ABCDEF-123456", "token in URL query"],
    ["https://x.io/a?sig=Zm9vYmFy", "token in URL query"],
    ["https://x.io/a?signature=Zm9vYmFyYmF6", "token in URL query"],
    ["password: hunter2hunter2", "credential assignment"],
    ["API_KEY=abcd1234efgh", "credential assignment"],
    ['secret = "s3cr3t-value-here"', "credential assignment"],
  ])("flags %j as %s", (text, rule) => {
    expect(scanText(text)).toEqual([rule]);
  });

  it.each([
    "Click Save to store the new password",
    "Enter a password",
    "Password: secret",
    "task-management-overview-page-with-a-long-name",
    "https://trackxai.kalebtec.com/mcp",
    "you@example.com",
    "Mail you@mail.example.org or ops@host.test or a@b.invalid.",
    "Install from the @docsxai scope",
    "Authorization: required for this call",
    "Authorization: Bearer",
    "Authorization: <your token>",
    "Authorization: Basic",
    "172.15.0.1 and 172.32.0.1",
    "192.169.1.1",
    "169.253.1.1",
    "8.8.8.8",
    "10.0.0",
    "v10.1.2.3",
    "Windows 10.0.19045.1",
    "110.0.0.1",
    "https://x.io/a?token=<your-token>",
    "https://x.io/a?key=abc",
    "https://x.io/a?page=2&sort=name",
    "monkey=abcdefghij",
    "1127.0.0.12",
    "Ratio 1::1",
    "mylocalhost",
    "Bearer",
  ])("lets %j through", (text) => {
    expect(scanText(text)).toEqual([]);
  });

  it("flags a four-part version number inside a private range, as an address", () => {
    expect(scanText("version 10.1.2.3")).toEqual(["private network address (10.x.x.x)"]);
  });

  it("flags an access_token query parameter by both the query and the credential rule", () => {
    expect(scanText("https://x.io/?access_token=abcdef123456")).toEqual([
      "token in URL query",
      "credential assignment",
    ]);
  });

  it("reports each rule once, loopback first", () => {
    expect(scanText("localhost 127.0.0.1 sk-abcdefghijklmnopqrstuvwx")).toEqual([
      "loopback host (localhost)",
      "loopback address (127.x.x.x)",
      "API key (sk-)",
    ]);
  });
});

describe("guardPack", () => {
  it("is empty for a clean pack", () => {
    expect(guardPack(packWith({ title: "App", caption: "A caption" }))).toEqual([]);
    expect(() => assertGuarded(packWith({}))).not.toThrow();
  });

  it("names the manifest path of a leak in title, caption, alt or a callout", () => {
    const pack = packWith({
      title: "Run on localhost",
      caption: "At 127.0.0.1",
      alt: "Shows ::1",
      copy: "Use 0.0.0.0",
    });
    expect(guardPack(pack)).toEqual([
      'flows["f"].title.en: loopback host (localhost)',
      'flows["f"].steps["s"].alt.en: loopback address (::1)',
      'flows["f"].steps["s"].caption.en: loopback address (127.x.x.x)',
      'flows["f"].steps["s"].variants["en.light.390"].callouts[2].copy: unspecified address (0.0.0.0)',
    ]);
  });

  it("never prints the text it matched", () => {
    const secret = "hunter2hunter2";
    const leaks = guardPack(packWith({ copy: `password: ${secret}` }));
    expect(leaks).toHaveLength(1);
    expect(leaks.join("\n")).not.toContain(secret);
    expect(() => assertGuarded(packWith({ copy: `password: ${secret}` }))).toThrow(
      /pack guard stopped the build:\n {2}- flows\["f"\]\.steps\["s"\]\.variants\["en\.light\.390"\]\.callouts\[2\]\.copy: credential assignment/,
    );
    try {
      assertGuarded(packWith({ copy: `password: ${secret}` }));
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
