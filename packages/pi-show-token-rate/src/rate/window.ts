/**
 * One scale's trailing window.
 *
 * A `TokenWindow` holds one monotonic counter's checkpoints and answers how
 * many tokens per second that scale produced over the trailing
 * {@link LIVE_WINDOW_MS}. Two scales exist — a provider usage count and a
 * character estimate — and they are never mixed, so each window only ever
 * subtracts checkpoints that share its unit. {@link USAGE_GUARD} and
 * {@link ESTIMATE_GUARD} are what distinguish them.
 *
 * An estimated window stores **credited** tokens rather than the raw count:
 * a character count says when text *arrived*, not when it was generated, so a
 * whole tool call can land in one delta and imply an absurd rate. Each interval
 * may credit at most `burstTolerance` times the pace the window is already
 * running at, measured from the window's own raw tokens so a genuinely fast
 * stream is not throttled while it ramps up. A provider count is measured, so
 * its guard is wide open.
 *
 * Checkpoints arrive in strictly increasing `at` order and only ever fall off
 * the *front*, so a cursor walks the consumed prefix forward once per
 * checkpoint (amortized O(1)) instead of rebuilding the window on every delta.
 * `rate()` reads exactly two points — the newest and the baseline — so the
 * points in between are only kept until they age out.
 */

/**
 * Trailing window for the live rate. Long enough to smooth bursty deltas,
 * short enough that a real slowdown still shows up within a couple of seconds.
 */
export const LIVE_WINDOW_MS = 3_000;

/**
 * How much faster than the stream's own recent pace a single delta may be
 * before it is treated as a buffered flush. A genuine 2× acceleration passes;
 * a tool call landing after a paced stream does not.
 */
export const BURST_TOLERANCE = 2;

/**
 * Ceiling used while a window cannot measure its own pace yet — the first
 * second of a response. Anything above it inside a single interval is treated
 * as a flush. It only has to be a plausible generation speed; it is unrelated
 * to the status line's display thresholds.
 */
export const MIN_CREDIT_TPS = 100;

/** How much history an estimated window needs before it reports anything. */
export const MIN_ESTIMATE_WINDOW_MS = 1_000;

/**
 * How many consumed checkpoints may pile up in front of the cursor before they
 * are reclaimed in one splice. Bounds the dead prefix while amortizing the
 * compaction over that many deltas.
 */
const PRUNE_SLACK = 64;

/** Tunables that turn a window into a measured or an estimated one. */
export interface WindowGuard {
  /** Windows younger than this report nothing. */
  readonly minWindowMs: number;
  /** Floor for the per-interval credit ceiling, in tok/s. */
  readonly minCreditTps: number;
  /** Multiple of the window's own raw rate one interval may credit. */
  readonly burstTolerance: number;
}

/**
 * Guard for the provider scale. A reported usage count is measured, so it
 * answers as soon as it moves and is never second-guessed.
 */
export const USAGE_GUARD: WindowGuard = {
  minWindowMs: 0,
  minCreditTps: Number.POSITIVE_INFINITY,
  burstTolerance: Number.POSITIVE_INFINITY,
};

/** Guard for the estimate scale. See the module doc. */
export const ESTIMATE_GUARD: WindowGuard = {
  minWindowMs: MIN_ESTIMATE_WINDOW_MS,
  minCreditTps: MIN_CREDIT_TPS,
  burstTolerance: BURST_TOLERANCE,
};

/** A checkpoint: cumulative raw tokens and what the window credits them. */
interface Checkpoint {
  /** Wall-clock stamp in milliseconds. */
  at: number;
  /** Cumulative raw count at `at` (monotonic). */
  raw: number;
  /** Cumulative credited count at `at` (monotonic). */
  credited: number;
}

/** One trailing window, all counted in the same unit. */
export class TokenWindow {
  #points: Checkpoint[] = [];
  /** Index of the oldest checkpoint that can still become a baseline. */
  #head = 0;
  /** Newest checkpoint at/before the window cutoff, once one exists. */
  #baseline: Checkpoint | undefined;
  readonly #guard: WindowGuard;

  constructor(guard: WindowGuard) {
    this.#guard = guard;
  }

  /**
   * Record a cumulative count. A stamp that does not move forward and a
   * counter that goes backwards are both dropped, so a provider that resets
   * its usage counter cannot produce a spike.
   */
  observe(at: number, tokens: number): void {
    const last = this.#points.at(-1);
    if (last && (at <= last.at || tokens < last.raw)) return;

    // The first observation only opens the window: there is no interval to
    // credit yet, and crediting its counter would let prefill count.
    const credit = last
      ? Math.min(
          tokens - last.raw,
          ((at - last.at) * this.#creditCeiling(last.at)) / 1000,
        )
      : 0;

    this.#points.push({
      at,
      raw: tokens,
      credited: (last?.credited ?? 0) + credit,
    });
    this.#prune(at);
  }

  /**
   * Credited rate over the trailing {@link LIVE_WINDOW_MS}, in tokens per
   * second. `null` when nothing was observed, when the window is younger than
   * `minWindowMs`, when the newest checkpoint has fallen out of the window,
   * or when no token was credited inside it.
   */
  rate(now: number): number | null {
    const current = this.#points.at(-1);
    if (!current || current.at <= now - LIVE_WINDOW_MS) return null;
    const baseline = this.#baseline ?? this.#points[this.#head];
    if (!baseline) return null;
    const elapsed = current.at - baseline.at;
    if (elapsed < this.#guard.minWindowMs || elapsed <= 0) return null;
    const tokens = current.credited - baseline.credited;
    if (tokens <= 0) return null;
    return (tokens * 1000) / elapsed;
  }

  /**
   * Raw rate over the trailing window, ignoring the credit guard. Used as the
   * basis for the next interval's ceiling: it follows a paced stream exactly,
   * so the guard does not throttle a genuinely fast one on its way up.
   */
  #rawRate(now: number): number | null {
    const current = this.#points.at(-1);
    if (!current || current.at <= now - LIVE_WINDOW_MS) return null;
    const baseline = this.#baseline ?? this.#points[this.#head];
    if (!baseline) return null;
    const elapsed = current.at - baseline.at;
    if (elapsed <= 0) return null;
    const tokens = current.raw - baseline.raw;
    if (tokens <= 0) return null;
    return (tokens * 1000) / elapsed;
  }

  /**
   * Tokens one interval may credit per second: uncapped for a measured scale,
   * otherwise at least `minCreditTps` and at most `burstTolerance` times the
   * raw trailing rate.
   */
  #creditCeiling(now: number): number {
    if (!Number.isFinite(this.#guard.minCreditTps)) {
      return Number.POSITIVE_INFINITY;
    }
    const raw = this.#rawRate(now) ?? 0;
    return Math.max(this.#guard.minCreditTps, raw * this.#guard.burstTolerance);
  }

  /**
   * Retire the checkpoints that just fell out of the trailing window, keeping
   * the newest of them as the next baseline. The cursor only moves forward, so
   * each checkpoint is visited once for the whole response; the consumed
   * prefix is dropped in one splice once it has grown past {@link PRUNE_SLACK}.
   */
  #prune(now: number): void {
    const cutoff = now - LIVE_WINDOW_MS;
    for (;;) {
      const point = this.#points[this.#head];
      if (!point || point.at > cutoff) break;
      this.#baseline = point;
      this.#head += 1;
    }
    if (this.#head > PRUNE_SLACK) {
      this.#points.splice(0, this.#head);
      this.#head = 0;
    }
  }
}
