/**
 * TTFT metric — how long the model took to start producing output.
 *
 * The anchor is the assistant message's own `timestamp`, which pi sets when it
 * opens the response stream, before the request is built and sent. The reading
 * is the gap to the first token-bearing stream event, so it covers network,
 * queueing and prefill but not local prompt assembly. Wall-clock jumps past
 * {@link MAX_PLAUSIBLE_TTFT_MS} are refused rather than printed.
 *
 * Every assistant response has its own reading, so a tool-calling turn updates
 * the row once per model request. A response that errors, is aborted, or never
 * produces a token leaves the previous reading in place.
 */

import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

import { formatTtft } from "../format.ts";
import { isDroppedResponse } from "./message.ts";
import type { AssistantMessage, Metric, Theme } from "./types.ts";

type StreamEvent = MessageUpdateEvent["assistantMessageEvent"];

/**
 * Large enough that a real prefill is never mistaken for a clock artifact,
 * small enough that a wall-clock jump is. Readings beyond it are dropped and
 * the previous value stays on the row.
 */
export const MAX_PLAUSIBLE_TTFT_MS = 300_000;

/**
 * The earliest event that proves output started. A content-block `*_start` and
 * its first `*_delta` both signal the arrival of the same first token, so
 * whichever pi delivers first wins. An empty delta carries no token: providers
 * emit those as stream scaffolding, not as output.
 */
function isFirstToken(event: StreamEvent): boolean {
  switch (event.type) {
    case "text_start":
    case "thinking_start":
    case "toolcall_start":
      return true;
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return event.delta.length > 0;
    default:
      return false;
  }
}

export class TtftMetric implements Metric {
  /** Request-start stamp of the response currently streaming. */
  #anchor: number | undefined;
  /** This response's reading, once its first token arrived. */
  #value: number | undefined;
  /** Whether `#value` belongs to the response currently streaming. */
  #measured = false;
  /** Last measured reading; what the idle row shows. */
  #frozen: number | undefined;

  reset(): void {
    this.#anchor = undefined;
    this.#value = undefined;
    this.#measured = false;
    this.#frozen = undefined;
  }

  onMessageStart(message: AssistantMessage): void {
    this.#anchor = message.timestamp;
    this.#value = undefined;
    this.#measured = false;
  }

  onUpdate(event: MessageUpdateEvent, now: number): void {
    if (this.#measured) return;
    if (!isFirstToken(event.assistantMessageEvent)) return;

    const anchor = this.#anchor;
    if (anchor === undefined) return;
    const ms = now - anchor;
    if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_PLAUSIBLE_TTFT_MS) return;

    this.#value = ms;
    this.#measured = true;
  }

  onMessageEnd(message: AssistantMessage, _now: number): void {
    // Interrupted or failed: keep the previous reading rather than freezing a
    // latency that describes a response which never finished.
    if (isDroppedResponse(message)) return;
    if (this.#measured) this.#frozen = this.#value;
  }

  render(theme: Theme, streaming: boolean, _now: number): string {
    // While streaming before the first token there is nothing to measure yet:
    // carry the previous reading over, dimmed, instead of blanking the slot.
    const ms = streaming && this.#measured ? this.#value : this.#frozen;
    return formatTtft(theme, { ms, streaming, measured: this.#measured });
  }
}
