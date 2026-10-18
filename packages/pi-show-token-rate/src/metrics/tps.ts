/**
 * TPS metric — how fast the model is producing output tokens right now.
 *
 * There is no settled rate and no session history: this metric shows the
 * trailing-window rate while the response streams, then keeps the last reading
 * (dimmed) once it ends. The window math lives in `../rate/`; this module owns
 * the stream wiring and the display state.
 *
 * Token counts come from the provider's cumulative `usage.output` when it
 * advances, and from a character estimate otherwise. Both scales are fed on
 * every delta so a provider that reports usage only at the end, reports a
 * count that does not advance, or resets its counter cannot freeze the number.
 */

import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

import { formatTps } from "../format.ts";
import {
  type CharCount,
  countWideChars,
  emptyCharCount,
  estimateTokens,
  type LiveRate,
  RateTracker,
} from "../rate/index.ts";
import { isDroppedResponse } from "./message.ts";
import type { AssistantMessage, Metric, Theme } from "./types.ts";

type StreamEvent = MessageUpdateEvent["assistantMessageEvent"];

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

export class TpsMetric implements Metric {
  #tracker = new RateTracker();
  #count: CharCount = emptyCharCount();
  /** Last still-readable live rate; what the idle row shows. */
  #frozen: LiveRate | undefined;

  reset(): void {
    this.#tracker.reset();
    this.#count = emptyCharCount();
    this.#frozen = undefined;
  }

  onMessageStart(_message: AssistantMessage): void {
    this.#tracker.reset();
    this.#count = emptyCharCount();
  }

  onUpdate(event: MessageUpdateEvent, now: number): void {
    const message = event.message;
    if (message.role !== "assistant") return;

    const delta = deltaText(event.assistantMessageEvent);
    if (!delta) return;

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
  }

  onMessageEnd(message: AssistantMessage, now: number): void {
    if (!isDroppedResponse(message)) {
      // Capture the freshest window value before dropping the trackers, so the
      // idle row shows where the stream actually ended.
      const live = this.#tracker.live(now);
      if (live) this.#frozen = live;
    }
    this.#tracker.reset();
    this.#count = emptyCharCount();
  }

  render(theme: Theme, streaming: boolean, now: number): string {
    let view: LiveRate | undefined;
    let measured = false;
    if (streaming) {
      // `now` matters: a scale whose newest checkpoint has fallen out of the
      // trailing window is not measurable, and the other scale answers.
      const live = this.#tracker.live(now);
      // Nothing measurable yet for this response — keep the last known reading
      // rather than blanking the row, but leave the number dim until it is a
      // reading of *this* response.
      view = live ?? this.#frozen;
      measured = live !== null;
    } else {
      view = this.#frozen;
    }

    return formatTps(theme, { rate: view?.tokPerSec, streaming, measured });
  }
}
