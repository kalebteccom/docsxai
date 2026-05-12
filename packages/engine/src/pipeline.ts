// Calibration pipeline contract.
//
// Calibration runs in an agent context (the host agent supplies inference; the engine never
// calls a model API). Stages are typed functions; the host agent decides when to invoke each,
// supplies any ambiguity resolutions, and persists intermediate state.
//
// The signalling contract is structured pause/resume on stage return — one ambiguity is one
// agent turn, which matches the skill-provider request/response model:
//
//   const r = await stage.run(input);
//   if (r.status === "needs_resolution") {
//     const resolution = /* host agent picks a candidate or supplies a selector */;
//     const r2 = await stage.resume(r.resumeToken, resolution);
//     ...
//   }
//
// Execution (deterministic, headless, no agent context, no LLM) does not use this — it consumes
// the doc pack a calibration produced. See flow-runtime (to come).

/** Why the engine couldn't proceed without the host agent. The protocol is the same for every reason. */
export type AmbiguityReason =
  | "multiple_locator_matches"
  | "no_locator_match"
  | "unstable_locator"
  | "ambiguous_step_intent"
  | "missing_precondition"
  | "needs_value";

export interface LocatorCandidate {
  /** A concrete selector the host agent may choose. */
  selector: string;
  /** Engine-gathered evidence for why this is a plausible match (role, text, test-id, position, etc.). */
  evidence?: Record<string, unknown>;
}

export interface Ambiguity {
  /** Where in the flow this arose, e.g. `"flow.steps[3]"` or a step id. */
  stepRef: string;
  reason: AmbiguityReason;
  /** Human-readable summary for the host agent's prompt. */
  message: string;
  /** Present for locator-shaped ambiguities; the host agent may pick one or supply a fresh selector. */
  candidates?: LocatorCandidate[];
  /** Free-form extra context (page title, surrounding text, screenshot ref, ...). */
  context?: Record<string, unknown>;
}

/** How the host agent resolves an {@link Ambiguity}. Exactly one field is set, matching the ambiguity's shape. */
export type Resolution =
  | { kind: "pick_candidate"; index: number }
  | { kind: "use_selector"; selector: string }
  | { kind: "provide_value"; value: string }
  | { kind: "confirm" }
  | { kind: "skip_step" }
  | { kind: "abort"; reason?: string };

export type StageResult<TState> =
  | { status: "ok"; state: TState }
  | { status: "needs_resolution"; ambiguity: Ambiguity; resumeToken: string };

/** A calibration stage. `TInput` is what it's given, `TState` is what it produces (and threads to the next stage). */
export interface Stage<TInput, TState> {
  readonly name: "discovery" | "mapping" | "commit" | (string & {});
  /** Run the stage from the start. */
  run(input: TInput): Promise<StageResult<TState>>;
  /** Resume a stage that returned `needs_resolution`, with the host agent's resolution. */
  resume(resumeToken: string, resolution: Resolution): Promise<StageResult<TState>>;
}

/** Thrown when `resume` is called with an unknown / already-consumed token. */
export class UnknownResumeTokenError extends Error {
  constructor(token: string) {
    super(`unknown or already-consumed resume token: ${token}`);
    this.name = "UnknownResumeTokenError";
  }
}

let resumeTokenCounter = 0;
/** Mint an opaque, process-unique resume token. (Not a security token — it just keys suspended stage state.) */
export function newResumeToken(prefix = "rt"): string {
  resumeTokenCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${resumeTokenCounter.toString(36)}`;
}
