/**
 * TUI formatting — pure functions, no side effects, no I/O.
 *
 * The status line is intentionally terse so it fits next to pi's own footer
 * stats without crowding them:
 *
 *   ⚡ 62 tok/s          while the model streams (trailing-window rate)
 *   ⚡ 62 tok/s          the last measured rate, dimmed, once the stream ends
 *   ⚡ tok/s —           nothing measured yet (marker still green while streaming)
 *
 * While streaming the rate is coloured by the spec's buckets — green above
 * 50 tok/s, yellow from 10 through 50, red below 10 — and the `⚡` marker is
 * green. Once the stream ends the number keeps its value but is dimmed, and
 * the marker goes back to dim.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Theme = ExtensionContext["ui"]["theme"];

const LABEL = "⚡";
export const RATE_UNIT = "tok/s";

/** Strictly above this many displayed tok/s the rate is green. */
const FAST_ABOVE = 50;
/** At or above this many displayed tok/s the rate is yellow; below it, red. */
const SLOW_MIN = 10;

/** Everything the status line can render. */
export interface RateView {
  /** Tokens per second to show; omitted when nothing has been measured. */
  rate?: number;
  /** While true the `⚡` marker is green. */
  streaming?: boolean;
  /**
   * Whether `rate` is a live measurement. While streaming, a response that
   * cannot be measured yet carries the last reading over under a green marker;
   * `measured: false` dims that carried-over number so it is not read as live.
   * Defaults to true whenever `streaming` is set.
   */
  measured?: boolean;
}

/**
 * The numeric value the label shows: one decimal below 10 (a slow model is
 * exactly where precision is interesting), whole tokens above it. Colour is
 * picked from this same value, so the label and its bucket never disagree.
 */
function displayedValue(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

/** Rate → short display string. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const shown = displayedValue(value);
  if (shown < 10) return shown.toFixed(1);
  return String(shown);
}

function rateColor(theme: Theme, value: number): string {
  const text = formatRate(value);
  const shown = displayedValue(value);
  if (shown > FAST_ABOVE) return theme.fg("success", text);
  if (shown >= SLOW_MIN) return theme.fg("warning", text);
  // Below the spec's slow threshold the rate reads as a problem, not as quiet.
  return theme.fg("error", text);
}

export function formatStatusLine(theme: Theme, view: RateView): string {
  // The marker is green while the model streams — a live signal independent of
  // the rate's own colour — and dim once the response is over.
  const label = theme.fg(view.streaming ? "success" : "dim", LABEL);
  if (
    view.rate === undefined ||
    !Number.isFinite(view.rate) ||
    view.rate <= 0
  ) {
    return [label, " ", theme.fg("dim", `${RATE_UNIT} —`)].join("");
  }

  // Streaming is the only state where the number means "right now"; a
  // carried-over reading (streaming but not measurable yet) and the frozen
  // idle value are both shown dim.
  const measured = view.streaming && view.measured !== false;
  const rate = measured
    ? rateColor(theme, view.rate)
    : theme.fg("dim", formatRate(view.rate));

  return [label, " ", rate, " ", theme.fg("dim", RATE_UNIT)].join("");
}
