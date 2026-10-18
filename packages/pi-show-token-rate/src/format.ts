/**
 * Status-line formatting — pure functions, no side effects, no I/O.
 *
 * The row is one segment per metric, joined by a dim `·`:
 *
 *   TPS 62 tok/s · TTFT 1.2s
 *
 * Labels are always dim; only a measured number carries colour, so the marker
 * never competes with the value it describes. Idle readings — the frozen last
 * value, and a reading carried over while the current response has none yet —
 * are dim too.
 *
 * TPS is bucketed by the spec's thresholds (green above 50 tok/s, yellow from
 * 10 through 50, red below 10). TTFT is green below one second, yellow through
 * three, red above. Both are bucketed by the number actually displayed, so a
 * value and its colour never disagree.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Theme = ExtensionContext["ui"]["theme"];

const TPS_LABEL = "TPS";
const TTFT_LABEL = "TTFT";
export const RATE_UNIT = "tok/s";
/** TTFT unit below one second. */
export const TTFT_UNIT_MS = "ms";
/** TTFT unit at and above one second. */
export const TTFT_UNIT_S = "s";
/** The value slot's "no number to show" glyph, shared by every metric. */
const NO_VALUE = "—";

/** Strictly above this many displayed tok/s the rate is green. */
const FAST_ABOVE = 50;
/** At or above this many displayed tok/s the rate is yellow; below it, red. */
const SLOW_MIN = 10;

/** Below this many seconds a TTFT is green. */
const TTFT_FAST_BELOW_S = 1;
/** Through this many seconds a TTFT is yellow; above it, red. */
const TTFT_SLOW_THROUGH_S = 3;

/** State of the TPS segment. */
export interface TpsView {
  /** Tokens per second to show; omitted when nothing has been measured. */
  rate?: number;
  /** While true a live reading is coloured; false is idle. */
  streaming?: boolean;
  /**
   * Whether `rate` belongs to the response being streamed. A response that
   * cannot be measured yet carries the last reading over; `measured: false`
   * dims it so it is not read as live. Defaults to `streaming`.
   */
  measured?: boolean;
}

/** State of the TTFT segment. */
export interface TtftView {
  /** Latency in milliseconds; omitted when nothing has been measured. */
  ms?: number;
  /** While true a live reading is coloured; false is idle. */
  streaming?: boolean;
  /** Whether `ms` belongs to the response being streamed. See {@link TpsView.measured}. */
  measured?: boolean;
}

/**
 * The numeric value a rate label shows: one decimal below 10 (a slow model is
 * exactly where precision is interesting), whole tokens above it. Colour is
 * picked from this same value, so the label and its bucket never disagree.
 */
function displayedRate(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

/** Rate number → display string, without the unit. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return NO_VALUE;
  const shown = displayedRate(value);
  if (shown < 10) return shown.toFixed(1);
  return String(shown);
}

/** A TTFT reading split into the number and the unit to print next to it. */
export interface TtftDisplay {
  /** Number text, e.g. `1.2` or `840`. */
  value: string;
  /** Unit that goes with `value` (`s` or `ms`). */
  unit: string;
  /**
   * The same reading in seconds, rounded the way it is displayed. Colour
   * buckets use this so `3.04s` prints yellow rather than red.
   */
  seconds: number;
}

/**
 * TTFT → adaptive display: whole milliseconds below one second (where the
 * sub-second precision is the interesting part) and one decimal of seconds
 * above it. `null` when there is no reading to show.
 *
 * The unit is picked from the rounded milliseconds, so a reading that prints
 * as `1000ms` cannot happen: 999.6 rounds to 1000 and prints as `1.0s`. The
 * displayed number, its unit and its colour bucket then always agree.
 */
export function ttftDisplay(ms: number): TtftDisplay | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const whole = Math.round(ms);
  if (whole < TTFT_FAST_BELOW_S * 1_000) {
    return { value: String(whole), unit: TTFT_UNIT_MS, seconds: whole / 1000 };
  }
  const seconds = Math.round(ms / 100) / 10;
  return { value: seconds.toFixed(1), unit: TTFT_UNIT_S, seconds };
}

function rateColor(theme: Theme, value: number): string {
  const shown = displayedRate(value);
  const text = formatRate(value);
  if (shown > FAST_ABOVE) return theme.fg("success", text);
  if (shown >= SLOW_MIN) return theme.fg("warning", text);
  // Below the spec's slow threshold the rate reads as a problem, not as quiet.
  return theme.fg("error", text);
}

function ttftColor(theme: Theme, display: TtftDisplay): string {
  if (display.seconds < TTFT_FAST_BELOW_S)
    return theme.fg("success", display.value);
  if (display.seconds <= TTFT_SLOW_THROUGH_S) {
    return theme.fg("warning", display.value);
  }
  return theme.fg("error", display.value);
}

/** The TPS segment, e.g. `TPS 62 tok/s` or `TPS — tok/s`. */
export function formatTps(theme: Theme, view: TpsView): string {
  const label = theme.fg("dim", TPS_LABEL);
  if (
    view.rate === undefined ||
    !Number.isFinite(view.rate) ||
    view.rate <= 0
  ) {
    return [label, theme.fg("dim", `${NO_VALUE} ${RATE_UNIT}`)].join(" ");
  }

  // Streaming is the only state where the number means "right now"; a carried
  // over reading (streaming but not measurable yet) and the frozen idle value
  // are both shown dim.
  const measured = view.streaming && view.measured !== false;
  const number = measured
    ? rateColor(theme, view.rate)
    : theme.fg("dim", formatRate(view.rate));
  return [label, number, theme.fg("dim", RATE_UNIT)].join(" ");
}

/** The TTFT segment, e.g. `TTFT 1.2s`, `TTFT 840ms` or `TTFT — ms`. */
export function formatTtft(theme: Theme, view: TtftView): string {
  const label = theme.fg("dim", TTFT_LABEL);
  const display = view.ms === undefined ? null : ttftDisplay(view.ms);
  if (!display) {
    return [label, theme.fg("dim", `${NO_VALUE} ${TTFT_UNIT_MS}`)].join(" ");
  }

  const measured = view.streaming && view.measured !== false;
  const number = measured
    ? ttftColor(theme, display)
    : theme.fg("dim", display.value);
  return [label, `${number}${theme.fg("dim", display.unit)}`].join(" ");
}

/** Join already-formatted segments with the row's dim separator. */
export function joinSegments(
  theme: Theme,
  segments: readonly string[],
): string {
  return segments.join(` ${theme.fg("dim", "·")} `);
}
