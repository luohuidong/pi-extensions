/**
 * Token-rate status line controller.
 *
 * Owns the footer entry: it observes assistant stream events, turns them
 * into a rate, throttles the writes so a 100 tok/s stream does not ask the
 * TUI to re-render 100 times a second, and keeps the session statistics the
 * line and `/token-rate stats` read from.
 *
 * The controller holds no timers and no handles — pi delivers stream events
 * for the lifetime of a response, and `message_end` is the last one. That
 * keeps `session_shutdown` a no-op and avoids the "start resources in
 * `session_start`" trap the extension API warns about.
 */

import type {
  ExtensionContext,
  MessageEndEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";

import { formatStatusLine } from "./format.ts";
import {
  countContentChars,
  estimateTokensFromChars,
  type RateSample,
  type RateSummary,
  RateTracker,
  summarize,
} from "./rate.ts";

/** Footer row identifier. Locked: other extensions may look the row up. */
const STATUS_KEY = "token-rate";

/**
 * Minimum gap between footer writes while streaming. 150ms is ~6 updates per
 * second — fast enough to look live, slow enough to stay off the render path
 * of every token delta.
 */
const WRITE_INTERVAL_MS = 150;

/** Cap on retained samples, so a very long session cannot grow unbounded. */
const MAX_SAMPLES = 200;

type StreamEvent = MessageUpdateEvent["assistantMessageEvent"];
type AssistantMessage = Extract<
  MessageEndEvent["message"],
  { role: "assistant" }
>;

/** Characters carried by a token-bearing stream event; 0 for lifecycle events. */
function deltaChars(event: StreamEvent): number {
  switch (event.type) {
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return event.delta.length;
    default:
      return 0;
  }
}

/**
 * Stop reasons that end a response without finishing it. pi still emits
 * `message_end` for these, and the window they produce is a truncated sample
 * of a model that was cut off — folding it into `avg` / `peak` would bias both.
 */
function isDroppedResponse(message: AssistantMessage): boolean {
  return message.stopReason === "aborted" || message.stopReason === "error";
}

export class TokenRateLine {
  #tracker = new RateTracker();
  #samples: RateSample[] = [];
  #chars = 0;
  #visible = true;
  #lastWriteAt = Number.NEGATIVE_INFINITY;
  #rendered: string | undefined;
  readonly #now: () => number;

  /** `now` is injectable so tests can drive the throttle deterministically. */
  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Session start: forget everything, including any line a reload left behind. */
  start(ctx: ExtensionContext): void {
    this.#tracker.abort();
    this.#samples = [];
    this.#chars = 0;
    this.#visible = true;
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#rendered = undefined;
    this.#write(ctx, undefined);
  }

  /** A new assistant message begins; the generation window reopens here. */
  onMessageStart(
    ctx: ExtensionContext,
    message: MessageEndEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;
    this.#tracker.arm();
    this.#chars = 0;
    // The next delta writes immediately instead of waiting out an old throttle.
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
  }

  /** Stream progress. Throttled: the tracker always sees every observation. */
  onUpdate(ctx: ExtensionContext, event: MessageUpdateEvent): void {
    if (!ctx.hasUI) return;
    const message = event.message;
    if (message.role !== "assistant") return;

    const chars = deltaChars(event.assistantMessageEvent);
    if (chars === 0) return;

    const now = this.#now();
    this.#chars += chars;
    const usage = message.usage.output;
    const reported = Number.isFinite(usage) && usage > 0;
    this.#tracker.observe(
      now,
      reported ? usage : estimateTokensFromChars(this.#chars),
      reported ? "usage" : "estimate",
    );

    if (now - this.#lastWriteAt < WRITE_INTERVAL_MS) return;
    this.#lastWriteAt = now;
    this.#render(ctx, true);
  }

  /** The response is done: record the sample and repaint the settled rate. */
  onMessageEnd(
    ctx: ExtensionContext,
    message: MessageEndEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;

    if (isDroppedResponse(message)) {
      // Interrupted or failed: keep the previous settled line instead of
      // showing a rate that was never really measured.
      this.#tracker.abort();
      this.#lastWriteAt = Number.NEGATIVE_INFINITY;
      this.#render(ctx, false);
      return;
    }

    const usage = message.usage.output;
    const reported = Number.isFinite(usage) && usage > 0;
    // Without provider usage, prefer the richest estimate available: chars
    // accumulated from deltas, or the finished content if it holds more.
    // Counting the content is the expensive half (it stringifies tool-call
    // arguments), so it stays behind the `reported` check.
    const tokens = reported
      ? usage
      : Math.max(
          estimateTokensFromChars(this.#chars),
          estimateTokensFromChars(countContentChars(message.content)),
        );

    const sample = this.#tracker.finish(
      this.#now(),
      tokens,
      reported ? "usage" : "estimate",
    );
    if (sample) {
      this.#samples.push(sample);
      if (this.#samples.length > MAX_SAMPLES) this.#samples.shift();
    }

    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#render(ctx, false);
  }

  /** Flip the line on or off. Returns the new visibility. */
  toggle(ctx: ExtensionContext): boolean {
    this.#visible = !this.#visible;
    this.#render(ctx, this.#tracker.streaming);
    return this.#visible;
  }

  /** Forget collected samples, keep the current visibility. */
  reset(ctx: ExtensionContext): void {
    this.#samples = [];
    this.#render(ctx, this.#tracker.streaming);
  }

  summary(): RateSummary {
    return summarize(this.#samples);
  }

  /** Live rate while streaming, last response's rate once settled. */
  #render(ctx: ExtensionContext, streaming: boolean): void {
    if (!this.#visible) {
      // Forget the cached line so showing it again always repaints — but
      // don't re-clear a row that is already blank on every stream tick.
      if (this.#rendered === undefined) return;
      this.#rendered = undefined;
      this.#write(ctx, undefined);
      return;
    }

    const live = streaming ? this.#tracker.liveRate() : null;
    // Nothing measurable yet for this response (no token inside the window) —
    // keep the previous line instead of blanking it out mid-stream.
    if (streaming && live === null) return;

    const summary = this.summary();
    const rate = live ?? summary.last?.tokPerSec;
    // The live rate is a difference of the window's checkpoints, so it counts
    // as estimated exactly when the window opened on estimates — a provider
    // that starts reporting usage mid-stream keeps the `~` until the response
    // settles on the reported count.
    const source =
      live !== null ? this.#tracker.windowSource : summary.last?.source;

    const text = formatStatusLine(ctx.ui.theme, {
      rate,
      estimated: source === "estimate",
      // One response has no "average" — it would just repeat the last value.
      average: summary.count >= 2 ? summary.average : undefined,
    });

    if (text === this.#rendered) return;
    this.#rendered = text;
    this.#write(ctx, text);
  }

  #write(ctx: ExtensionContext, text: string | undefined): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
