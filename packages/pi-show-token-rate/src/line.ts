/**
 * Token-rate status line controller.
 *
 * Owns the footer entry: it observes assistant stream events, turns them into
 * a live rate, throttles the writes so a 100 tok/s stream does not ask the TUI
 * to re-render 100 times a second, and keeps the last reading once the
 * response ends.
 *
 * Only streaming output is measured. There is no settled rate and no session
 * history — while the model streams the line shows the current rate (coloured
 * by speed), and afterwards it keeps the last reading dimmed.
 *
 * The controller holds no timers and no handles — pi delivers stream events
 * for the lifetime of a response, and `message_end` is the last one.
 */

import type {
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";

import { formatStatusLine } from "./format.ts";
import {
  type CharCount,
  countWideChars,
  emptyCharCount,
  estimateTokens,
  type LiveRate,
  RateTracker,
} from "./rate/index.ts";

/** Footer row identifier. */
const STATUS_KEY = "token-rate";

/**
 * Minimum gap between footer writes while streaming. ~6 updates per second is
 * fast enough to look live, slow enough to stay off the render path of every
 * token delta.
 */
const WRITE_INTERVAL_MS = 150;

type StreamEvent = MessageUpdateEvent["assistantMessageEvent"];
type AssistantMessage = Extract<
  MessageEndEvent["message"],
  { role: "assistant" }
>;

/** Text carried by a token-bearing stream event; undefined for the rest. */
function deltaText(event: StreamEvent): string | undefined {
  switch (event.type) {
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return event.delta;
    default:
      return undefined;
  }
}

/**
 * Stop reasons that end a response without finishing it. pi still emits
 * `message_end` for these, and the half-window they leave behind is not a rate
 * the model sustained — dropping it keeps the frozen line honest.
 */
function isDroppedResponse(message: AssistantMessage): boolean {
  return message.stopReason === "aborted" || message.stopReason === "error";
}

export class TokenRateLine {
  #tracker = new RateTracker();
  #count: CharCount = emptyCharCount();
  #visible = true;
  #streaming = false;
  /** Last still-readable live rate; what the idle line shows. */
  #frozen: LiveRate | undefined;
  #lastWriteAt = Number.NEGATIVE_INFINITY;
  #rendered: string | undefined;
  readonly #now: () => number;

  /** `now` is injectable so tests can drive the throttle deterministically. */
  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Session start: forget everything, including a line a reload left behind. */
  start(ctx: ExtensionContext): void {
    this.#tracker.reset();
    this.#count = emptyCharCount();
    this.#visible = true;
    this.#streaming = false;
    this.#frozen = undefined;
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#rendered = undefined;
    this.#write(ctx, undefined);
  }

  /** A new assistant message begins; the measurement window reopens here. */
  onMessageStart(
    ctx: ExtensionContext,
    message: MessageStartEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;
    this.#tracker.reset();
    this.#count = emptyCharCount();
    this.#streaming = true;
    // The next delta writes immediately instead of waiting out an old throttle.
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
  }

  /** Stream progress. Throttled: the tracker always sees every observation. */
  onUpdate(ctx: ExtensionContext, event: MessageUpdateEvent): void {
    if (!ctx.hasUI) return;
    const message = event.message;
    if (message.role !== "assistant") return;

    const delta = deltaText(event.assistantMessageEvent);
    if (!delta) return;

    const now = this.#now();
    const wide = countWideChars(delta);
    // Tool-call JSON is charged against its own, denser ratio; answer and
    // thinking text against prose.
    if (event.assistantMessageEvent.type === "toolcall_delta") {
      this.#count.toolChars += delta.length;
      this.#count.toolWideChars += wide;
    } else {
      this.#count.textChars += delta.length;
      this.#count.textWideChars += wide;
    }

    // Feed both scales: providers disagree on when `usage.output` moves, and
    // the tracker picks whichever window is measurable. A provider count that
    // does not advance cannot freeze the number because the estimate window
    // keeps collecting points.
    const usage = message.usage.output;
    if (Number.isFinite(usage) && usage > 0) {
      this.#tracker.observe(now, usage, "usage");
    }
    this.#tracker.observe(now, estimateTokens(this.#count), "estimate");

    if (now - this.#lastWriteAt < WRITE_INTERVAL_MS) return;
    this.#lastWriteAt = now;
    this.#render(ctx, true);
  }

  /** The response is done: freeze the last live reading and dim the line. */
  onMessageEnd(
    ctx: ExtensionContext,
    message: MessageEndEvent["message"],
  ): void {
    if (!ctx.hasUI || message.role !== "assistant") return;

    if (isDroppedResponse(message)) {
      // Interrupted or failed: keep the previous reading instead of freezing a
      // rate that was never really measured.
      this.#tracker.reset();
    } else {
      // Capture the freshest window value before dropping the trackers, so the
      // idle line shows where the stream actually ended.
      const live = this.#tracker.live(this.#now());
      if (live) this.#frozen = live;
      this.#tracker.reset();
    }

    this.#count = emptyCharCount();
    this.#streaming = false;
    this.#lastWriteAt = Number.NEGATIVE_INFINITY;
    this.#render(ctx, false);
  }

  /** Flip the line on or off. Returns the new visibility. */
  toggle(ctx: ExtensionContext): boolean {
    this.#visible = !this.#visible;
    this.#render(ctx, this.#streaming);
    return this.#visible;
  }

  /**
   * Streaming paints the live rate, coloured by speed, under a green marker;
   * before anything is measurable it keeps the last reading dimmed instead of
   * blanking the row. Idle repaints the frozen reading with no accent.
   */
  #render(ctx: ExtensionContext, streaming: boolean): void {
    if (!this.#visible) {
      // Forget the cached line so showing it again always repaints — but
      // don't re-clear a row that is already blank on every stream tick.
      if (this.#rendered === undefined) return;
      this.#rendered = undefined;
      this.#write(ctx, undefined);
      return;
    }

    let view: LiveRate | undefined;
    let measured = false;
    if (streaming) {
      // `now` matters: a scale whose newest checkpoint has fallen out of the
      // trailing window is not measurable, and the other scale answers instead.
      const live = this.#tracker.live(this.#now());
      // Nothing measurable yet for this response — keep the last known reading
      // rather than blanking the row, but leave the number dim: only the green
      // marker says the model is streaming.
      view = live ?? this.#frozen;
      measured = live !== null;
    } else {
      view = this.#frozen;
    }

    const text = formatStatusLine(ctx.ui.theme, {
      rate: view?.tokPerSec,
      streaming,
      measured,
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
