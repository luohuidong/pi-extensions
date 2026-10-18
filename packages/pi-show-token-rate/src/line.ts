/**
 * Status-line controller.
 *
 * Owns the footer row: it observes assistant stream events, offers each of
 * them to every metric, throttles the writes so a fast stream does not ask the
 * TUI to re-render on every delta, and composes the segments into one line.
 *
 * The controller holds no timers and no handles — pi delivers stream events for
 * the lifetime of a response, and `message_end` is the last one. It knows
 * nothing about what a metric measures; adding a segment means adding a metric
 * module and appending it to the metric list.
 */

import type {
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";

import { joinSegments } from "./format.ts";
import { TpsMetric } from "./metrics/tps.ts";
import { TtftMetric } from "./metrics/ttft.ts";
import type { Metric } from "./metrics/types.ts";

/** Footer row identifier. */
const STATUS_KEY = "token-rate";

/**
 * Minimum gap between footer writes while streaming. ~6 updates per second is
 * fast enough to look live, slow enough to stay off the render path of every
 * token delta.
 */
const WRITE_INTERVAL_MS = 150;

export class MetricsLine {
  /** Segments in display order: TPS first, then TTFT. */
  readonly #metrics: readonly Metric[] = [new TpsMetric(), new TtftMetric()];
  #visible = true;
  #streaming = false;
  #lastWriteAt = Number.NEGATIVE_INFINITY;
  #rendered: string | undefined;
  readonly #now: () => number;

  /** `now` is injectable so tests can drive the throttle deterministically. */
  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Session start: forget everything, including a line a reload left behind. */
  start(ctx: ExtensionContext): void {
    for (const metric of this.#metrics) metric.reset();
    this.#visible = true;
    this.#streaming = false;
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#rendered = undefined;
    this.#write(ctx, undefined);
  }

  /** A new assistant message begins; every metric reopens its measurement. */
  onMessageStart(
    ctx: ExtensionContext,
    message: MessageStartEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;
    for (const metric of this.#metrics) metric.onMessageStart(message);
    this.#streaming = true;
    // The next delta writes immediately instead of waiting out an old throttle.
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
  }

  /** Stream progress. Throttled: every metric still sees every observation. */
  onUpdate(ctx: ExtensionContext, event: MessageUpdateEvent): void {
    if (!ctx.hasUI || event.message.role !== "assistant") return;

    const now = this.#now();
    for (const metric of this.#metrics) metric.onUpdate(event, now);

    if (now - this.#lastWriteAt < WRITE_INTERVAL_MS) return;
    this.#lastWriteAt = now;
    this.#render(ctx, true);
  }

  /** The response is done: metrics freeze their last reading and the row dims. */
  onMessageEnd(
    ctx: ExtensionContext,
    message: MessageEndEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;

    const now = this.#now();
    for (const metric of this.#metrics) metric.onMessageEnd(message, now);
    this.#streaming = false;
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#render(ctx, false);
  }

  /** Flip the row on or off. Returns the new visibility. */
  toggle(ctx: ExtensionContext): boolean {
    this.#visible = !this.#visible;
    this.#render(ctx, this.#streaming);
    return this.#visible;
  }

  /** Paint every metric's segment, or blank the row while hidden. */
  #render(ctx: ExtensionContext, streaming: boolean): void {
    if (!this.#visible) {
      // Forget the cached line so showing it again always repaints — but
      // don't re-clear a row that is already blank on every stream tick.
      if (this.#rendered === undefined) return;
      this.#rendered = undefined;
      this.#write(ctx, undefined);
      return;
    }

    const now = this.#now();
    const segments = this.#metrics.map((metric) =>
      metric.render(ctx.ui.theme, streaming, now),
    );
    const text = joinSegments(ctx.ui.theme, segments);
    if (text === this.#rendered) return;
    this.#rendered = text;
    this.#write(ctx, text);
  }

  #write(ctx: ExtensionContext, text: string | undefined): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
