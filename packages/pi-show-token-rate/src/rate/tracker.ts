/**
 * Live output-rate tracking.
 *
 * `RateTracker` receives `(timestamp, cumulative count, scale)` observations
 * from one streaming response and reports how fast the model is generating
 * right now. Nothing here knows about pi, the terminal, or the network.
 *
 * There is no settled / whole-response number and no session history: the
 * extension only measures while the model streams. A caller that wants to keep
 * showing the last rate after the stream ends holds on to the final
 * {@link RateTracker.live} reading itself.
 *
 * Observations arrive in two scales, so two independent windows are kept:
 *
 *   - `usage` — the provider's cumulative output-token count. Providers
 *     disagree on when this moves: OpenAI-compatible endpoints send it once,
 *     on the final chunk; some send it on every chunk; Anthropic sends a
 *     small count at the start and only advances it in a terminal event pi
 *     does not surface.
 *   - `estimate` — the caller's cumulative character estimate, which advances
 *     on every streamed delta.
 *
 * `live()` reports the `usage` window whenever it is measurable and plausible
 * (that count is exact) and the `estimate` window otherwise, so the number
 * keeps moving no matter how the provider reports usage.
 */

import { ESTIMATE_GUARD, TokenWindow, USAGE_GUARD } from "./window.ts";

/**
 * Fastest rate the extension will report, in tok/s. Output tokens cannot be
 * generated faster than this; a window implying more is a delivery artifact —
 * a provider that buffers a tool call and flushes it in one burst, or a usage
 * counter that jumps. Such a window is reported as unmeasurable rather than
 * printed, so the status line keeps its previous value.
 */
export const MAX_PLAUSIBLE_TPS = 5_000;

/**
 * Where a token count came from:
 *
 *   - `usage` — the provider reported real output tokens (authoritative)
 *   - `estimate` — derived from streamed characters
 */
export type TokenSource = "usage" | "estimate";

/** The live rate, plus the scale it is counted in. */
export interface LiveRate {
  tokPerSec: number;
  source: TokenSource;
}

/** Fresh trailing windows for both scales. */
function createScales(): Record<TokenSource, TokenWindow> {
  return {
    usage: new TokenWindow(USAGE_GUARD),
    estimate: new TokenWindow(ESTIMATE_GUARD),
  };
}

/** Live rate over two scales, one trailing window each. */
export class RateTracker {
  #scales = createScales();

  /** Drop every checkpoint, e.g. at the start of a new response. */
  reset(): void {
    this.#scales = createScales();
  }

  /**
   * Record progress on one scale at `at`. Later calls append to that scale's
   * window, so two scales are never subtracted from each other.
   *
   * Feed both scales whenever both are available: the tracker decides which
   * one to report, and a provider window that stops advancing cannot fall back
   * unless the estimate window kept collecting points.
   */
  observe(at: number, tokens: number, source: TokenSource): void {
    this.#scales[source].observe(at, tokens);
  }

  /**
   * The most trustworthy live rate at `now`, or `null` when neither scale has
   * a measurable one. Provider usage wins whenever its window is moving,
   * fresh and plausible; the estimate keeps the number live on providers that
   * only report usage at the end, report a count that does not advance while
   * streaming, or stop reporting it partway through.
   *
   * `now` must be the current clock: a scale whose newest checkpoint has
   * fallen out of the trailing window is not measurable, and the other scale
   * answers instead.
   */
  live(now: number): LiveRate | null {
    const usage = this.#scales.usage.rate(now);
    if (usage !== null && usage <= MAX_PLAUSIBLE_TPS) {
      return { tokPerSec: usage, source: "usage" };
    }

    const estimate = this.#scales.estimate.rate(now);
    if (estimate !== null && estimate <= MAX_PLAUSIBLE_TPS) {
      return { tokPerSec: estimate, source: "estimate" };
    }

    return null;
  }
}
