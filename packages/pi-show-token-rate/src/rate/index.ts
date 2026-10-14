/**
 * Token-rate math — the public entry point of the rate module.
 *
 * Three rules drive everything in here:
 *
 *   1. **Only the streaming rate is measured.** There is no settled,
 *      whole-response number and no session history: the tracker answers "how
 *      fast is the model generating right now", and that is all.
 *   2. **The live number is a trailing-window rate.** Providers emit deltas in
 *      bursts and stall while writing a tool call, so a per-event rate would
 *      flicker; averaging over the last few seconds smooths it out without
 *      lagging far behind reality.
 *   3. **Every scale gets its own window.** A provider usage count and a
 *      character estimate are different units and are never subtracted from
 *      each other. The estimate additionally bounds how much a single delta
 *      may credit, because a character count only says when text *arrived*.
 *
 * `line.ts` / `format.ts` and the tests import from this file only; the
 * modules above it are implementation details.
 */

export {
  type CharCount,
  countWideChars,
  emptyCharCount,
  estimateTokens,
  estimateTokensFromChars,
} from "./estimate.ts";
export {
  type LiveRate,
  MAX_PLAUSIBLE_TPS,
  RateTracker,
  type TokenSource,
} from "./tracker.ts";
export {
  BURST_TOLERANCE,
  ESTIMATE_GUARD,
  LIVE_WINDOW_MS,
  MIN_CREDIT_TPS,
  MIN_ESTIMATE_WINDOW_MS,
  TokenWindow,
  USAGE_GUARD,
  type WindowGuard,
} from "./window.ts";
