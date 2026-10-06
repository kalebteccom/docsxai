// Publish guards: text that must never reach a public screenshot pack. Runs over every string a
// reader sees (title, caption, alt, callout copy). A hit names the manifest path and the rule,
// never the matched text, so a leaked secret is not printed into a CI log.

import type { ScreensPack } from "./pack-schema.js";

interface Rule {
  name: string;
  pattern: RegExp;
}

export const LOOPBACK_RULES: Rule[] = [
  { name: "loopback host (localhost)", pattern: /(?:^|[^A-Za-z0-9-])localhost(?![A-Za-z0-9-])/i },
  { name: "loopback address (127.x.x.x)", pattern: /(?<![\d.])127(?:\.\d{1,3}){3}(?![\d.])/ },
  { name: "loopback address (::1)", pattern: /(?:^|[^\w:])\[?::1\]?(?![\w:])/ },
  { name: "unspecified address (0.0.0.0)", pattern: /(?<![\d.])0\.0\.0\.0(?![\d.])/ },
];

// One IPv4 octet, 0 to 255. A run of digits too long to be an octet (a build number such as
// `10.0.19045.1`) therefore does not match.
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const privateRange = (prefix: string, tail: number): RegExp =>
  new RegExp(`(?<![\\w.])${prefix}(?:\\.${OCTET}){${tail}}(?!\\d|\\.\\d)`);

/**
 * Addresses that only mean something on one network: 10/8, 172.16/12, 192.168/16 and link-local
 * 169.254/16. A four-part version number inside one of those ranges (`version 10.1.2.3`) cannot be
 * told from an address and is flagged; `v10.1.2.3` and `10.0.19045.1` are not.
 */
export const PRIVATE_NETWORK_RULES: Rule[] = [
  { name: "private network address (10.x.x.x)", pattern: privateRange("10", 3) },
  {
    name: "private network address (172.16-31.x.x)",
    pattern: privateRange("172\\.(?:1[6-9]|2\\d|3[01])", 2),
  },
  { name: "private network address (192.168.x.x)", pattern: privateRange("192\\.168", 2) },
  { name: "link-local address (169.254.x.x)", pattern: privateRange("169\\.254", 2) },
];

/**
 * Email addresses. The reserved example domains (RFC 2606 and RFC 6761: `example.com`, `.org`,
 * `.net` and their subdomains, plus the `.test`, `.invalid` and `.example` TLDs) are allowed, so
 * copy can show `you@example.com`. Any other address is flagged, `you@example.com.evil.io` included.
 */
const RESERVED_EMAIL_DOMAIN =
  "(?:[A-Za-z0-9-]+\\.)*(?:example\\.(?:com|org|net)|test|invalid|example)(?![A-Za-z0-9-]|\\.[A-Za-z0-9])";

export const SECRET_RULES: Rule[] = [
  {
    name: "email address",
    pattern: new RegExp(
      `[A-Za-z0-9._%+-]+@(?!${RESERVED_EMAIL_DOMAIN})[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}(?![A-Za-z0-9-])`,
    ),
  },
  {
    // A scheme other than Bearer with credentials, or a bare credential of 16 or more characters.
    // `Authorization: Bearer ...` belongs to the bearer rule; a `<placeholder>` has no match.
    name: "Authorization header",
    pattern:
      /\bAuthorization\s*:\s*(?!Bearer\b)(?:(?:Basic|Digest|Token|Negotiate|NTLM|ApiKey|AWS4-HMAC-SHA256)\s+[^\s<>]{8,}|[A-Za-z0-9._~+/=-]{16,})/i,
  },
  {
    // Values of 6 or more token characters: `?token=<your-token>` and `?key=abc` pass.
    name: "token in URL query",
    pattern: /[?&](?:token|key|sig|signature|access_token|api_key)=[A-Za-z0-9._~%+/=-]{6,}/i,
  },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JSON web token", pattern: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { name: "API key (sk-)", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Google API key", pattern: /\bAIza[\w-]{35}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: "credential assignment",
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i,
  },
];

/** The names of every rule `text` trips: loopback, then private network, then secrets. */
export function scanText(text: string): string[] {
  return [...LOOPBACK_RULES, ...PRIVATE_NETWORK_RULES, ...SECRET_RULES]
    .filter((r) => r.pattern.test(text))
    .map((r) => r.name);
}

function* strings(pack: ScreensPack): Generator<[string, string]> {
  for (const [flowId, flow] of Object.entries(pack.flows)) {
    const flowAt = `flows["${flowId}"]`;
    for (const [locale, text] of Object.entries(flow.title ?? {}))
      yield [`${flowAt}.title.${locale}`, text];
    for (const [stepId, step] of Object.entries(flow.steps)) {
      const stepAt = `${flowAt}.steps["${stepId}"]`;
      for (const [locale, text] of Object.entries(step.alt))
        yield [`${stepAt}.alt.${locale}`, text];
      for (const [locale, text] of Object.entries(step.caption ?? {})) {
        yield [`${stepAt}.caption.${locale}`, text];
      }
      for (const [key, variant] of Object.entries(step.variants)) {
        for (const callout of variant.callouts) {
          yield [`${stepAt}.variants["${key}"].callouts[${callout.index}].copy`, callout.copy];
        }
      }
    }
  }
}

/** One line per leak: `<manifest path>: <rule>`. Empty when the pack is clean. */
export function guardPack(pack: ScreensPack): string[] {
  const leaks: string[] = [];
  for (const [at, text] of strings(pack)) {
    for (const rule of scanText(text)) leaks.push(`${at}: ${rule}`);
  }
  return leaks;
}

/** Throws one error listing every leak. */
export function assertGuarded(pack: ScreensPack): void {
  const leaks = guardPack(pack);
  if (leaks.length > 0) {
    throw new Error(`pack guard stopped the build:\n${leaks.map((l) => `  - ${l}`).join("\n")}`);
  }
}
