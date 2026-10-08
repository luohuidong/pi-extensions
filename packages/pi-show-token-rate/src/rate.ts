/**
 * Token-rate math.
 *
 * Pure functions plus one small per-response tracker. Nothing here knows
 * about pi, the terminal, or the network: the caller feeds it `(timestamp,
 * output tokens)` observations and gets rates back, which keeps every rule
 * below unit-testable in isolation.
 *
 * Two rules drive the whole module:
 *
 *   1. **Rate is measured over the generation window** — from the first
 *      observed token to the last one. Prompt prefill / time-to-first-token
 *      is deliberately excluded, because "how fast does this model stream"
 *      means generation speed, not request latency.
 *   2. **The live number is a trailing-window rate**, not an instantaneous
 *      one. Providers emit token deltas in bursts (and stall while writing a
 *      tool call or a thinking block), so a per-event rate flickers between
 *      0 and several hundred tok/s. Averaging over the last few seconds
 *      smooths that out without lagging far behind reality.
 */

/**
 * Chars per token for the fallback estimator. Matches pi's own
 * `estimateTokens` heuristic (content length ÷ 4), which is what the TUI
 * uses when a provider has not reported usage yet.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Trailing window for the live rate. Long enough to smooth bursty deltas,
 * short enough that a real slowdown (thinking, tool-call JSON) still shows up
 * within a couple of seconds.
 */
export const LIVE_WINDOW_MS = 3_000;

/**
 * Where a token count came from:
 *
 *   - `usage` — the provider reported real output tokens (authoritative)
 *   - `estimate` — derived from streamed characters ÷ 4 (providers such as
 *     OpenAI-compatible endpoints only send usage on the final chunk)
 */
export type TokenSource = "usage" | "estimate";

export interface RateSample {
  /** Output tokens produced inside the measured window. */
  tokens: number;
  /** Generation window in milliseconds (first token → last token). */
  elapsedMs: number;
  /** Tokens per second over that window. */
  tokPerSec: number;
  /** Whether `tokens` is a real count or a chars ÷ 4 estimate. */
  source: TokenSource;
}

export interface Checkpoint {
  /** Wall-clock stamp in milliseconds. */
  at: number;
  /** Output tokens produced so far (monotonic). */
  tokens: number;
}

/**
 * The first checkpoint of a generation window, plus the scale its counter is
 * in. A chars ÷ 4 estimate and a provider usage count are not interchangeable,
 * so `finish()` has to know which one the window opened with.
 */
interface WindowStart extends Checkpoint {
  source: TokenSource;
}

/**
 * Structural subset of an assistant content block. Only the fields the
 * estimator reads are declared, so a real `AssistantMessage["content"]` is
 * assignable without an index signature.
 */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  arguments?: unknown;
}

/**
 * Chars ÷ 4 → tokens, rounded up. Non-finite or negative input → 0, so a
 * malformed event can never poison the rate with NaN.
 */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Total characters of an assistant message's content: answer text, thinking
 * text, and tool-call argument JSON. Mirrors what a tokenizer would see,
 * which is all the fallback estimator needs.
 */
export function countContentChars(content: readonly ContentBlock[]): number {
  let chars = 0;
  for (const block of content) {
    if (block.type === "toolCall") {
      chars += argumentsChars(block.arguments);
      continue;
    }
    chars += block.text?.length ?? block.thinking?.length ?? 0;
  }
  return chars;
}

function argumentsChars(args: unknown): number {
  if (args === undefined) return 0;
  try {
    return JSON.stringify(args)?.length ?? 0;
  } catch {
    // Cyclic or otherwise unserializable arguments — count as zero rather
    // than tearing down the stream handler.
    return 0;
  }
}

/**
 * Per-response rate tracker.
 *
 * Lifecycle: `arm()` on `message_start`, `observe()` on every token-bearing
 * stream event, then exactly one `finish()` on `message_end` (or `abort()`
 * when the response is dropped). The first `observe()` opens the generation
 * window, so prefill never counts against the rate.
 *
 * Two checkpoint sets are kept: `#first` pins the start of the generation
 * window so `finish()` can still average the whole response after pruning,
 * and `#checkpoints` holds only the trailing window that `liveRate()`
 * reads.
 */
export class RateTracker {
  #checkpoints: Checkpoint[] = [];
  #first: WindowStart | undefined;
  #armed = false;

  /** True between `arm()` and `finish()` / `abort()`. */
  get armed(): boolean {
    return this.#armed;
  }

  /** True once at least one token has been observed for this response. */
  get streaming(): boolean {
    return this.#checkpoints.length > 0;
  }

  /**
   * Scale the current window's checkpoints are counted in — the scale the
   * window *opened* with, not the scale of the newest observation. `undefined`
   * while nothing has been observed.
   *
   * Callers label the live rate from this: a provider that starts reporting
   * usage mid-stream does not upgrade the in-flight number to exact, it just
   * stops being believed for the rest of the window.
   */
  get windowSource(): TokenSource | undefined {
    return this.#first?.source;
  }

  /** Mark a response as in flight. Drops any state from the previous one. */
  arm(): void {
    this.#checkpoints = [];
    this.#first = undefined;
    this.#armed = true;
  }

  /**
   * Record progress. The first call opens the generation window; later calls
   * append. Non-monotonic stamps, token counts that go backwards, and
   * observations on a different scale than the window opened with are ignored,
   * so a provider that resets (or reorders, or starts reporting usage halfway
   * through) its usage counter cannot produce a spike.
   *
   * `source` is the scale `tokens` is counted in. Checkpoints inside one
   * window must share it — the counters are cumulative, so mixing them would
   * compare two different units.
   */
  observe(at: number, tokens: number, source: TokenSource): void {
    if (!this.#armed) this.arm();

    const last = this.#checkpoints.at(-1);
    if (last) {
      if (at <= last.at || tokens < last.tokens) return;
      // Stay on the scale the window opened with. `finish()` is where a
      // reported count is allowed to replace an estimated one.
      if (this.#first?.source !== source) return;
    } else {
      this.#first = { at, tokens, source };
    }

    this.#checkpoints.push({ at, tokens });
    this.#prune(at);
  }

  /**
   * Rate over the trailing {@link LIVE_WINDOW_MS}, in tokens per second.
   * `null` when nothing was observed yet, when the window holds a single
   * point, or when no new token arrived inside it.
   *
   * The window length is not a parameter: `#prune` already discards anything
   * older than `LIVE_WINDOW_MS`, so a wider window could only ever read from
   * checkpoints that no longer exist.
   */
  liveRate(): number | null {
    const current = this.#checkpoints.at(-1);
    if (!current) return null;

    const baseline = this.#baselineAt(current.at);
    const elapsedMs = current.at - baseline.at;
    const tokens = current.tokens - baseline.tokens;
    if (elapsedMs <= 0 || tokens <= 0) return null;

    return (tokens * 1000) / elapsedMs;
  }

  /**
   * Close the window and return the response's overall rate, or `null` when
   * the response produced no measurable tokens (empty reply, instant abort).
   * The rate covers the whole generation window, which is what pruning the
   * live checkpoints would otherwise throw away.
   */
  finish(at: number, tokens: number, source: TokenSource): RateSample | null {
    const first = this.#first;
    this.#checkpoints = [];
    this.#first = undefined;
    this.#armed = false;

    if (!first) return null;
    const elapsedMs = at - first.at;
    // Tokens that were already on the counter when the window opened are
    // excluded — they were produced during prefill. That subtraction is only
    // meaningful when both numbers use the same scale: a provider that only
    // reports usage on its final chunk opened the window on chars ÷ 4
    // estimates, so there the full count is the closer approximation.
    const produced = first.source === source ? tokens - first.tokens : tokens;
    if (elapsedMs <= 0 || produced <= 0) return null;

    return {
      tokens: produced,
      elapsedMs,
      tokPerSec: (produced * 1000) / elapsedMs,
      source,
    };
  }

  /** Drop the in-flight response without producing a sample. */
  abort(): void {
    this.#checkpoints = [];
    this.#first = undefined;
    this.#armed = false;
  }

  /** Newest checkpoint at/before the window start; falls back to the oldest. */
  #baselineAt(now: number): Checkpoint {
    const cutoff = now - LIVE_WINDOW_MS;
    let baseline = this.#checkpoints[0];
    for (const checkpoint of this.#checkpoints) {
      if (checkpoint.at <= cutoff) baseline = checkpoint;
      else break;
    }
    return baseline;
  }

  /** Keep the window's tail plus the single baseline in front of it. */
  #prune(now: number): void {
    const cutoff = now - LIVE_WINDOW_MS;
    let baseline: Checkpoint | undefined;
    const kept: Checkpoint[] = [];
    for (const checkpoint of this.#checkpoints) {
      if (checkpoint.at <= cutoff) baseline = checkpoint;
      else kept.push(checkpoint);
    }
    this.#checkpoints = baseline ? [baseline, ...kept] : kept;
  }
}

export interface RateSummary {
  /** Number of completed responses. */
  count: number;
  /** Most recent completed response. */
  last: RateSample | undefined;
  /** Duration-weighted mean rate across completed responses. */
  average: number | undefined;
  /** Fastest completed response. */
  peak: number | undefined;
  /** How many of the samples came from the chars ÷ 4 fallback. */
  estimated: number;
}

/** Aggregate completed samples into the numbers the status line and `/token-rate stats` show. */
export function summarize(samples: readonly RateSample[]): RateSummary {
  if (samples.length === 0) {
    return {
      count: 0,
      last: undefined,
      average: undefined,
      peak: undefined,
      estimated: 0,
    };
  }

  let tokens = 0;
  let elapsedMs = 0;
  let peak = Number.NEGATIVE_INFINITY;
  let estimated = 0;
  for (const sample of samples) {
    tokens += sample.tokens;
    elapsedMs += sample.elapsedMs;
    if (sample.tokPerSec > peak) peak = sample.tokPerSec;
    if (sample.source === "estimate") estimated += 1;
  }

  return {
    count: samples.length,
    last: samples[samples.length - 1],
    average: elapsedMs > 0 ? (tokens * 1000) / elapsedMs : undefined,
    peak: Number.isFinite(peak) ? peak : undefined,
    estimated,
  };
}
