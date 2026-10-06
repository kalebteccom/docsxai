// Doc-pack schema — the artifacts a calibration run produces and an execution run consumes.
//
// Layout on disk:
//   <project>/flows/<flow>.flow.yaml          — flow-file (source of truth for execution)
//   <project>/docs/<flow>/<step>.md           — step write-ups (user-facing prose)
//   <project>/docs/<flow>/screenshots/<step>.png
//   <project>/docs/<flow>/annotations.json    — per-step annotation records (this module's AnnotationsFile)
//   A flow with a `matrix` writes the two lines above under docs/<flow>/<variant>/ instead.
//   <project>/docs/style.yaml + style.json    — style artifact (canonical + derived)
//   <project>/docs/locators.yaml              — locator manifest (one canonical locator per step)
//   <project>/auth/strategy.yaml              — target-site auth-strategy descriptor
//
// Runtime validation is done with zod; the exported TS types are inferred from the schemas
// so the two never drift.

import { z } from "zod";
import { EnvironmentSpec, LocaleTag } from "./environment-spec.js";
import { hasTrailingDot, isWindowsDeviceName } from "./flow-name-rules.js";
import { MatrixSpec, VariantInfo, VariantSelector } from "./matrix-spec.js";

export {
  ColorScheme,
  EnvironmentSpec,
  LocaleTag,
  VIEWPORT_PRESETS,
  ViewportPreset,
  ViewportSize,
} from "./environment-spec.js";
export {
  MAX_MATRIX_VARIANTS,
  MatrixSpec,
  MatrixViewport,
  VariantInfo,
  VariantSelector,
} from "./matrix-spec.js";

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
  "upload",
  "press",
  "hover",
  "select",
  "check",
  "uncheck",
  "wait",
  "hide",
  "show",
]);
export type ActionType = z.infer<typeof ActionType>;

/** Bounds for a step's `timeout_ms`, in milliseconds. 30 s is Playwright's own default wait. */
export const STEP_TIMEOUT_MIN_MS = 100;
export const STEP_TIMEOUT_MAX_MS = 30_000;

/** Actions whose `target` wait `timeout_ms` can bound (`show` acts instantly; `navigate`/`wait` have no target wait). */
const TARGET_WAIT_ACTIONS: ReadonlySet<ActionType> = new Set([
  "click",
  "fill",
  "upload",
  "press",
  "hover",
  "select",
  "check",
  "uncheck",
  "hide",
]);

/** True when a step's `timeout_ms` bounds something: its target wait, a `wait_for: settled`, or a `wait` step's own `wait_for` selector. */
function stepTimeoutHasEffect(s: {
  action: ActionType;
  target?: string | undefined;
  wait_for?: WaitSpec | undefined;
}): boolean {
  if (s.wait_for === "settled") return true;
  if (TARGET_WAIT_ACTIONS.has(s.action)) return s.target !== undefined;
  const w = s.wait_for;
  return (
    s.action === "wait" &&
    w !== undefined &&
    typeof w === "object" &&
    "selector" in w &&
    w.timeout_ms === undefined
  );
}

/**
 * What to wait for after a step's action settles. `network_idle` / `element_stable` / `load` / `settled` are
 * named primitives (`settled` = fonts loaded, visible images loaded, viewport layout still, bounded by the
 * step's `timeout_ms`); `{ selector }` waits for an element to appear (Playwright's default timeout, ~30s) — give it
 * `timeout_ms` to override that (e.g. waiting on a multi-minute backend op that mounts a "done" element);
 * `{ timeout_ms }` alone is a blind sleep (last resort — for animations, not state).
 */
export const WaitSpec = z.union([
  z.enum(["network_idle", "element_stable", "load", "settled"]),
  z.object({ timeout_ms: z.number().int().positive() }).strict(),
  z.object({ selector: LocatorRef, timeout_ms: z.number().int().positive().optional() }).strict(),
]);
export type WaitSpec = z.infer<typeof WaitSpec>;

/** Post-step success criterion. Execution halts if it fails (no selector fallbacks — drift is a signal). */
export const SuccessSpec = z.union([
  z.object({ visible: LocatorRef }).strict(),
  z.object({ hidden: LocatorRef }).strict(),
  z.object({ url_matches: z.string().min(1) }).strict(),
  z
    .object({ text_contains: z.object({ selector: LocatorRef, text: z.string() }).strict() })
    .strict(),
]);
export type SuccessSpec = z.infer<typeof SuccessSpec>;

export const NudgeOffset = z.object({ x: z.number(), y: z.number() }).strict();
export type NudgeOffset = z.infer<typeof NudgeOffset>;

// ---------------------------------------------------------------------------
// Redactions (`redactions:` — flow-level and per-step)
// ---------------------------------------------------------------------------

export const RedactionStyle = z.enum(["box", "pixelate"]);
export type RedactionStyle = z.infer<typeof RedactionStyle>;

/** A fixed rectangle in CSS pixels (viewport coordinates), scaled to device pixels at capture time. */
export const RedactionRegion = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type RedactionRegion = z.infer<typeof RedactionRegion>;

/**
 * One area to mask on every screenshot it applies to (step shots *and* halt shots): either an
 * element (locator ref / inline selector, resolved to its bounding box at capture time) or a fixed
 * `region`. Default `style` is `box` (solid #000 fill); `pixelate` is a 16-px mosaic. A selector
 * that matches nothing at capture time is skipped with a stderr warning — redacting an absent
 * element is vacuously satisfied, never a halt. Flow-level `redactions` apply to every step;
 * per-step `redactions` are additive.
 */
export const RedactionSpec = z.union([
  z.object({ selector: LocatorRef, style: RedactionStyle.optional() }).strict(),
  z.object({ region: RedactionRegion, style: RedactionStyle.optional() }).strict(),
]);
export type RedactionSpec = z.infer<typeof RedactionSpec>;

/** Most `obstacles` one annotation record may carry (the writer keeps the nearest this many). */
export const MAX_OBSTACLES = 40;

/** Bounds of `placement.max_width`, the widest outer callout box the burner may use, in screenshot px. */
export const MIN_CALLOUT_WIDTH = 120;
export const MAX_CALLOUT_WIDTH = 560;
/** Widest `placement.obstacle_radius` (CSS px) a flow may ask the obstacle scan for. */
export const MAX_OBSTACLE_RADIUS = 2000;

/**
 * Optional per-annotation placement settings for the burner. Every key is optional and an empty or
 * absent object changes nothing. The interactive viewer ignores them; `obstacle_radius` and
 * `obstacle_limit` steer the capture-time obstacle scan, the rest steer `docsxai-viewer burn`.
 */
export const AnnotationPlacement = z
  .object({
    /** Put the callout inside the target when the target is big enough to hold it (no arrow). */
    inside: z.boolean().optional(),
    /** Only try this side of the target (falls back to the usual order when nothing fits there). */
    side: z.enum(["top", "bottom", "left", "right"]).optional(),
    /** Where along the target's edge the callout sits: flush with its start, centred, or flush with its end. */
    align: z.enum(["start", "center", "end"]).optional(),
    /** `nudge` moves only the callout: the arrow stays on the target and a stem joins the two. */
    pin_arrow: z.boolean().optional(),
    /** Widest outer callout box in px (default 280, narrower on small screenshots with obstacles). */
    max_width: z.number().finite().min(MIN_CALLOUT_WIDTH).max(MAX_CALLOUT_WIDTH).optional(),
    /** CSS px around the target the obstacle scan covers (default 320). Read by `docsxai run`. */
    obstacle_radius: z.number().finite().min(0).max(MAX_OBSTACLE_RADIUS).optional(),
    /** Most obstacles recorded for this annotation (default {@link MAX_OBSTACLES}). Read by `docsxai run`. */
    obstacle_limit: z.number().int().min(1).max(MAX_OBSTACLES).optional(),
  })
  .strict();
export type AnnotationPlacement = z.infer<typeof AnnotationPlacement>;

export const StepAnnotation = z
  .object({
    copy: z.string().min(1),
    arrow: ArrowStyle.optional(),
    /**
     * Optional pixel offset applied to the callout + arrow after Popper-like placement. The halo (which
     * highlights the target element) stays on the target. Use this when two annotations on the same
     * screenshot would otherwise overlap each other — nudge one aside so both are readable.
     * Image-space pixels; small values (5–40 px in either direction) typically suffice.
     */
    nudge: NudgeOffset.optional(),
    /** Optional burner placement settings — see {@link AnnotationPlacement}. Copied onto the annotation record. */
    placement: AnnotationPlacement.optional(),
    /**
     * Optional override: the locator to anchor the halo/arrow to. Default = the step's `target`. Use this on
     * a step whose action *transitions the UI* — the action target vanishes (gets unmounted / replaced) and
     * a *different* element is what you want to highlight in the resulting state. Point this at the
     * surviving / appearing element.
     */
    target: LocatorRef.optional(),
    /**
     * Call-out text per locale, keyed by BCP-47 tag (`es`, `fr-CA`). `copy` stays required and is the
     * fallback. A variant takes its locale's entry (exact tag, then the language subtag), else `copy`.
     * The variant locale is the matrix locale, or `environment.locale` when the flow has no matrix locales.
     */
    copy_by_locale: z
      .record(LocaleTag, z.string().min(1))
      .refine((m) => Object.keys(m).length > 0, { message: "needs at least one locale" })
      .optional(),
    /** Variants this call-out is kept for. Needs a `matrix`; see {@link VariantSelector}. */
    only: VariantSelector.optional(),
    /** Variants this call-out is dropped from. Needs a `matrix`; see {@link VariantSelector}. */
    skip: VariantSelector.optional(),
  })
  .strict();
export type StepAnnotation = z.infer<typeof StepAnnotation>;

export const Step = z
  .object({
    id: z.string().min(1),
    action: ActionType,
    /**
     * Best-effort step: if the action / `wait_for` / `success` check throws (target absent, wait timed
     * out, etc.), **skip this step and continue** instead of halting the flow. For conditionally-present
     * UI — a confirmation modal that sometimes appears, a first-run tooltip, a cookie banner. A skipped
     * optional step emits no screenshot / annotation (same as a step skipped by `--start-from`). Prefer
     * this over a permissive comma-selector that no-ops on one branch.
     */
    optional: z.boolean().optional(),
    /**
     * How long, in ms, this step waits for its `target` before giving up (100–30000). Unset keeps the
     * driver default (Playwright's 30 s), so existing flows run exactly as before. The reason to set it
     * is an `optional: true` step whose target is usually absent: a short value (e.g. 1500) skips it fast
     * instead of holding the run for the full default. On a `wait` step it bounds the `wait_for`
     * `{ selector }` wait when that has no `timeout_ms` of its own. With `wait_for: settled` it is that wait's
     * whole budget (default 10 s), on any action. Rejected where it would bound nothing.
     */
    timeout_ms: z.number().int().min(STEP_TIMEOUT_MIN_MS).max(STEP_TIMEOUT_MAX_MS).optional(),
    /** Locator ref (`$name`) or inline selector. Optional for actions like `navigate` (uses `value`), `wait`, and `show` (no target = show everything hidden). */
    target: LocatorRef.optional(),
    /** Action payload: text for `fill`, file path for `upload`, key for `press`, path/URL for `navigate`, option for `select`. */
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
    /** Extra redactions for this step's screenshots, additive on top of the flow-level list. */
    redactions: z.array(RedactionSpec).min(1).optional(),
    /** Variants this step runs for (the others skip it). Needs a `matrix`; see {@link VariantSelector}. */
    only: VariantSelector.optional(),
    /** Variants this step is dropped from. Needs a `matrix`; see {@link VariantSelector}. */
    skip: VariantSelector.optional(),
  })
  .strict()
  .refine((s) => !(s.annotation && s.annotations), {
    message:
      "step has both `annotation` and `annotations`; use one (`annotations: [...]` for the multi-callout form)",
    path: ["annotations"],
  })
  .refine((s) => s.timeout_ms === undefined || stepTimeoutHasEffect(s), {
    message:
      "`timeout_ms` has no effect on this step: it bounds the wait for a `target` (click, fill, upload, press, hover, select, check, uncheck, hide), a `wait_for: settled`, or a `wait` step's `wait_for: { selector }` that has no `timeout_ms` of its own",
    path: ["timeout_ms"],
  });
export type Step = z.infer<typeof Step>;

/** A precondition the flow assumes (e.g. `{ logged_in_as: "editor" }`, `{ feature_flag: "recap.enabled" }`). */
export const Prerequisite = z.record(z.string(), z.union([z.string(), z.boolean()]));
export type Prerequisite = z.infer<typeof Prerequisite>;

/** Longest flow name. The name is a directory and file name under the workspace. */
export const MAX_FLOW_NAME_LENGTH = 64;

/**
 * A flow's name is a path segment: it names `flows/<name>.flow.yaml` and `docs/<name>/`, and
 * `run` writes under both. It starts with a letter or digit, then letters, digits, `.`, `_` and `-`
 * (so `Board_1.v2` is fine), never contains `..`, and is at most {@link MAX_FLOW_NAME_LENGTH} long.
 * A slash, a backslash, a leading dot and an absolute path are all outside that set. A trailing
 * `.` and a Windows device name (`con`, `nul`, `com1`, `lpt1`, ..., with or without an extension
 * part) are refused too, since Windows cannot create them.
 */
export const FlowName = z
  .string()
  .min(1)
  .max(MAX_FLOW_NAME_LENGTH)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "must start with a letter or digit and use only letters, digits, `.`, `_` and `-`",
  )
  .refine((n) => !n.includes(".."), { message: "must not contain `..`" })
  .refine((n) => !hasTrailingDot(n), { message: "must not end with `.`" })
  .refine((n) => !isWindowsDeviceName(n), {
    message: "must not be a Windows device name (con, prn, aux, nul, com1-9, lpt1-9)",
  });
export type FlowName = z.infer<typeof FlowName>;

export const FlowFile = z
  .object({
    name: FlowName,
    /**
     * Name of another flow whose steps run *first* (composition). The parent's `locators` + `prerequisites`
     * are merged in (this flow wins on collisions); step ids must be unique across the merge. Chains allowed
     * (A extends B extends C); cycles are rejected. Resolved at run time against `flows/<name>.flow.yaml`.
     * Typical use: factor out a shared preamble (Library → open a video → editor) so dependent flows don't
     * re-walk it every run. (`run --stop-after` operates on the merged step list.)
     */
    extends: FlowName.optional(),
    /**
     * Deterministic execution environment (frozen clock, locale, timezone, viewport, color scheme,
     * reduced motion). With `extends`, merged per-key — this flow's keys win over the parent's.
     */
    environment: EnvironmentSpec.optional(),
    /**
     * Expands the flow into variants: the product of the listed locales, color schemes and viewports.
     * Each variant runs under its own `environment` override and writes to `docs/<flow>/<variant>/`.
     * Not inherited through `extends`. See `flow-matrix.ts`.
     */
    matrix: MatrixSpec.optional(),
    /** Areas masked on every screenshot this flow produces (incl. halt shots). See {@link RedactionSpec}. */
    redactions: z.array(RedactionSpec).min(1).optional(),
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

/** A rectangle in screenshot pixels: finite position, finite non-negative size. */
export const BoundingBox = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();
export type BoundingBox = z.infer<typeof BoundingBox>;

export const AnnotationRecord = z
  .object({
    step: z.string().min(1),
    selector: z.string().min(1),
    bounding_box: BoundingBox.optional(),
    copy: z.string().min(1),
    arrow_style: ArrowStyle.optional(),
    /** Optional pixel offset applied to the callout + arrow at render time — see {@link NudgeOffset}. */
    nudge: NudgeOffset.optional(),
    /**
     * Optional boxes of page content (text, controls), in screenshot pixels, that the burner keeps this
     * annotation's callout from covering. The target itself is not listed. `docsxai run` writes it when
     * the workspace sets `annotations.obstacles`; a pipeline that knows the page layout may add it by
     * hand. At most {@link MAX_OBSTACLES} boxes. The engine measures them right after the screenshot, so
     * on a page that animates continuously they can differ slightly from what the image shows. Absent or
     * empty: the callout goes next to the target. The structural mirror in `packages/viewer/src/annotations.ts`
     * carries the same field.
     */
    obstacles: z.array(BoundingBox).max(MAX_OBSTACLES).optional(),
    /** Optional burner placement settings (inside the target, side, alignment, pinned arrow, width) — see {@link AnnotationPlacement}. */
    placement: AnnotationPlacement.optional(),
    /** 1-based index of this annotation *within its step's screenshot* — set only when the step has > 1 annotation, so the viewer can render a numbered badge. Absent → render as a plain (un-numbered) halo. */
    index: z.number().int().positive().optional(),
  })
  .strict();
export type AnnotationRecord = z.infer<typeof AnnotationRecord>;

export const AnnotationsFile = z
  .object({
    schema: z.literal("docsxai/annotations@1"),
    flow: z.string().min(1),
    /** The matrix variant these annotations belong to. Absent for a flow without a `matrix`. */
    variant: VariantInfo.optional(),
    annotations: z.array(AnnotationRecord),
  })
  .strict();
export type AnnotationsFile = z.infer<typeof AnnotationsFile>;

// ---------------------------------------------------------------------------
// Style artifact (`style.yaml` canonical → `style.json` derived)
// ---------------------------------------------------------------------------

export const StyleArtifact = z
  .object({
    schema: z.literal("docsxai/style@1"),
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
    schema: z.literal("docsxai/locators@1"),
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
export const CacheTtl = z.union([
  z.literal("session"),
  z.string().regex(/^\d+(ms|s|m|h)$/),
  z.number().int().positive(),
]);
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
    schema: z.literal("docsxai/auth-strategy@1"),
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
