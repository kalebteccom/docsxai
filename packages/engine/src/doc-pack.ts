// Doc-pack schema — the artifacts a calibration run produces and an execution run consumes.
//
// Layout on disk (see the portfolio spec, "Output layout"):
//   <project>/flows/<flow>.flow.yaml          — flow-file (source of truth for execution)
//   <project>/docs/<flow>/<step>.md           — step write-ups (user-facing prose)
//   <project>/docs/<flow>/screenshots/<step>.png
//   <project>/docs/<flow>/annotations.json    — per-step annotation records (this module's AnnotationsFile)
//   <project>/docs/style.yaml + style.json    — style artifact (canonical + derived)
//   <project>/docs/locators.yaml              — locator manifest (one canonical locator per step)
//   <project>/auth/strategy.yaml              — target-site auth-strategy descriptor
//
// Runtime validation is done with zod; the exported TS types are inferred from the schemas
// so the two never drift.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const ArrowStyle = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top",
  "bottom",
  "left",
  "right",
]);
export type ArrowStyle = z.infer<typeof ArrowStyle>;

/** A locator reference (`$play_button`) resolved against a flow-file's `locators` map, or an inline selector. */
export const LocatorRef = z.string().min(1);
export type LocatorRef = z.infer<typeof LocatorRef>;

// ---------------------------------------------------------------------------
// Flow-file (`<flow>.flow.yaml`)
// ---------------------------------------------------------------------------

export const ActionType = z.enum([
  "navigate",
  "click",
  "fill",
  "press",
  "hover",
  "select",
  "check",
  "uncheck",
  "wait",
]);
export type ActionType = z.infer<typeof ActionType>;

/**
 * What to wait for after a step's action settles. `network_idle` / `element_stable` / `load` are named
 * primitives; `{ selector }` waits for an element to appear (Playwright's default timeout, ~30s) — give it
 * `timeout_ms` to override that (e.g. waiting on a multi-minute backend op that mounts a "done" element);
 * `{ timeout_ms }` alone is a blind sleep (last resort — for animations, not state).
 */
export const WaitSpec = z.union([
  z.enum(["network_idle", "element_stable", "load"]),
  z.object({ timeout_ms: z.number().int().positive() }).strict(),
  z.object({ selector: LocatorRef, timeout_ms: z.number().int().positive().optional() }).strict(),
]);
export type WaitSpec = z.infer<typeof WaitSpec>;

/** Post-step success criterion. Execution halts if it fails (no selector fallbacks — drift is a signal). */
export const SuccessSpec = z.union([
  z.object({ visible: LocatorRef }).strict(),
  z.object({ hidden: LocatorRef }).strict(),
  z.object({ url_matches: z.string().min(1) }).strict(),
  z.object({ text_contains: z.object({ selector: LocatorRef, text: z.string() }).strict() }).strict(),
]);
export type SuccessSpec = z.infer<typeof SuccessSpec>;

export const StepAnnotation = z
  .object({
    copy: z.string().min(1),
    arrow: ArrowStyle.optional(),
    /**
     * Optional override: the locator to anchor the halo/arrow to. Default = the step's `target`. Use this on
     * a step whose action *transitions the UI* — the action target vanishes (gets unmounted / replaced) and
     * a *different* element is what you want to highlight in the resulting state. Point this at the
     * surviving / appearing element.
     */
    target: LocatorRef.optional(),
  })
  .strict();
export type StepAnnotation = z.infer<typeof StepAnnotation>;

export const Step = z
  .object({
    id: z.string().min(1),
    action: ActionType,
    /** Locator ref (`$name`) or inline selector. Optional for actions like `navigate` (uses `value`) or `wait`. */
    target: LocatorRef.optional(),
    /** Action payload: text for `fill`, key for `press`, path/URL for `navigate`, option for `select`. */
    value: z.string().optional(),
    wait_for: WaitSpec.optional(),
    success: SuccessSpec.optional(),
    /** Single call-out on this step's screenshot. Shorthand for a one-element `annotations` array. */
    annotation: StepAnnotation.optional(),
    /**
     * Multiple call-outs on the same screenshot — rendered as numbered badges (1, 2, …) so the reader sees
     * up front that there's more than one thing to look at without having to hover everything. Each entry
     * has its own `target` (defaults to the step's `target`) and `copy` / `arrow` — see {@link StepAnnotation}.
     * Mutually exclusive with `annotation`.
     */
    annotations: z.array(StepAnnotation).min(1).optional(),
  })
  .strict()
  .refine((s) => !(s.annotation && s.annotations), {
    message: "step has both `annotation` and `annotations`; use one (`annotations: [...]` for the multi-callout form)",
    path: ["annotations"],
  });
export type Step = z.infer<typeof Step>;

/** A precondition the flow assumes (e.g. `{ logged_in_as: "editor" }`, `{ feature_flag: "recap.enabled" }`). */
export const Prerequisite = z.record(z.string(), z.union([z.string(), z.boolean()]));
export type Prerequisite = z.infer<typeof Prerequisite>;

export const FlowFile = z
  .object({
    name: z.string().min(1),
    /**
     * Name of another flow whose steps run *first* (composition). The parent's `locators` + `prerequisites`
     * are merged in (this flow wins on collisions); step ids must be unique across the merge. Chains allowed
     * (A extends B extends C); cycles are rejected. Resolved at run time against `flows/<name>.flow.yaml`.
     * Typical use: factor out a shared preamble (Library → open a video → editor) so dependent flows don't
     * re-walk it every run. (`run --stop-after` operates on the merged step list.)
     */
    extends: z.string().min(1).optional(),
    prerequisites: z.array(Prerequisite).default([]),
    /** Named canonical locators referenced from steps as `$name`. One per name; no fallback lists. */
    locators: z.record(z.string(), z.string()).default({}),
    steps: z.array(Step).min(1),
  })
  .strict();
export type FlowFile = z.infer<typeof FlowFile>;

// ---------------------------------------------------------------------------
// Annotations (`<flow>/annotations.json`)
// ---------------------------------------------------------------------------

export const BoundingBox = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();
export type BoundingBox = z.infer<typeof BoundingBox>;

export const AnnotationRecord = z
  .object({
    step: z.string().min(1),
    selector: z.string().min(1),
    bounding_box: BoundingBox.optional(),
    copy: z.string().min(1),
    arrow_style: ArrowStyle.optional(),
    /** 1-based index of this annotation *within its step's screenshot* — set only when the step has > 1 annotation, so the viewer can render a numbered badge. Absent → render as a plain (un-numbered) halo. */
    index: z.number().int().positive().optional(),
  })
  .strict();
export type AnnotationRecord = z.infer<typeof AnnotationRecord>;

export const AnnotationsFile = z
  .object({
    schema: z.literal("site-docs/annotations@1"),
    flow: z.string().min(1),
    annotations: z.array(AnnotationRecord),
  })
  .strict();
export type AnnotationsFile = z.infer<typeof AnnotationsFile>;

// ---------------------------------------------------------------------------
// Style artifact (`style.yaml` canonical → `style.json` derived)
// ---------------------------------------------------------------------------

export const StyleArtifact = z
  .object({
    schema: z.literal("site-docs/style@1"),
    voice: z.record(z.string(), z.unknown()).optional(),
    structure: z.record(z.string(), z.unknown()).optional(),
    terminology: z.record(z.string(), z.string()).optional(),
    visual: z.record(z.string(), z.unknown()).optional(),
    localisation: z.record(z.string(), z.unknown()).optional(),
    /** Categories of testing-jargon the commit stage must strip from user-facing prose. */
    pruning_rules: z.array(z.string()).optional(),
  })
  .strict();
export type StyleArtifact = z.infer<typeof StyleArtifact>;

// ---------------------------------------------------------------------------
// Locator manifest (`locators.yaml`)
// ---------------------------------------------------------------------------

export const LocatorManifest = z
  .object({
    schema: z.literal("site-docs/locators@1"),
    /** flow name → locator name → canonical selector. One per name; no fallbacks. */
    flows: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .strict();
export type LocatorManifest = z.infer<typeof LocatorManifest>;

// ---------------------------------------------------------------------------
// Auth-strategy descriptor (`auth/strategy.yaml`)
// ---------------------------------------------------------------------------

export const StrategyName = z.enum([
  "api-login",
  "jwt-injection",
  "ui-form",
  "http-basic",
  "mtls",
  "pat-header",
  "email-otp",
  "totp",
  "webauthn",
  "manual-capture",
  "test-backdoor",
]);
export type StrategyName = z.infer<typeof StrategyName>;

/** `session` = use the captured session's own lifetime; otherwise a duration string (`30m`, `1h`) or ms number. */
export const CacheTtl = z.union([z.literal("session"), z.string().regex(/^\d+(ms|s|m|h)$/), z.number().int().positive()]);
export type CacheTtl = z.infer<typeof CacheTtl>;

export const RoleAuth = z
  .object({
    strategy: StrategyName,
    /** Env-var *names* holding credentials — never the values. May be `{}` (e.g. `manual-capture` needs none). */
    creds_env: z.record(z.string(), z.string()).default({}),
    options: z.record(z.string(), z.unknown()).default({}),
    cache: z
      .object({
        enabled: z.boolean().default(false),
        store: z.enum(["local", "backend"]).default("local"),
        /** Fallback expiry when no `auth_cookie` is set/found: a duration, or `session` (→ a 1h default). */
        ttl: CacheTtl.default("session"),
        /**
         * Name of the app's actual auth/session cookie. When set, the cached session's `expiresAt` is *that*
         * cookie's expiry — the real bound — rather than the `ttl` guess. Identify it from the captured jar
         * (`capture-auth` prints it): it's on the app's domain, long-lived (not an ephemeral IdP scratch
         * cookie), e.g. `AppSession.Production` / `.AspNetCore.Cookies` / `session`. Optional.
         */
        auth_cookie: z.string().min(1).optional(),
      })
      .strict()
      .default({ enabled: false, store: "local", ttl: "session" }),
  })
  .strict();
export type RoleAuth = z.infer<typeof RoleAuth>;

export const AuthStrategyDescriptor = z
  .object({
    schema: z.literal("site-docs/auth-strategy@1"),
    default_role: z.string().min(1),
    roles: z.record(z.string(), RoleAuth),
  })
  .strict()
  .refine((d) => d.default_role in d.roles, {
    message: "default_role must be one of the keys in roles",
    path: ["default_role"],
  });
export type AuthStrategyDescriptor = z.infer<typeof AuthStrategyDescriptor>;

// ---------------------------------------------------------------------------
// Revision metadata (linear immutable revisions per project)
// ---------------------------------------------------------------------------

export const RevisionKind = z.enum(["calibrate", "run", "edit"]);
export type RevisionKind = z.infer<typeof RevisionKind>;

export const RevisionMeta = z
  .object({
    rev_id: z.string().min(1),
    parent_rev_id: z.string().min(1).nullable(),
    kind: RevisionKind,
    author: z.string().min(1),
    /** ISO-8601 timestamp. */
    timestamp: z.string().min(1),
  })
  .strict();
export type RevisionMeta = z.infer<typeof RevisionMeta>;
