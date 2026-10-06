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

export const SECRET_RULES: Rule[] = [
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

/** The names of every rule `text` trips, loopback rules first. */
export function scanText(text: string): string[] {
  return [...LOOPBACK_RULES, ...SECRET_RULES]
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
