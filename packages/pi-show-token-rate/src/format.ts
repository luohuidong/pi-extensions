/**
 * TUI formatting — pure functions, no side effects, no I/O.
 *
 * The status line is intentionally terse so it fits next to pi's own footer
 * stats without crowding them:
 *
 *   ⚡ 62 tok/s          while the model streams (trailing-window rate)
 *   ⚡ 62 tok/s · avg 55 once the response settles
 *   ⚡ ~62 tok/s         a `~` marks a chars ÷ 4 estimate instead of real usage
 *   ⚡ tok/s —           nothing measured yet
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { RateSummary } from "./rate.ts";

export type Theme = ExtensionContext["ui"]["theme"];

const LABEL = "⚡";
export const RATE_UNIT = "tok/s";

/** At or above this many tok/s the rate is green. */
const FAST_MIN = 50;
/** At or above this many tok/s the rate is yellow; below that it is dim. */
const SLOW_MIN = 20;

/** Everything the status line can render. */
export interface RateView {
  /** Tokens per second to show; omitted when nothing has been measured. */
  rate?: number;
  /** Mark the rate as estimated (`~` prefix) rather than provider-reported. */
  estimated?: boolean;
  /** Session average, appended as `· avg NN` when present. */
  average?: number;
}

/**
 * Rate → short display string. Sub-10 values keep one decimal (a slow model
 * is exactly where precision is interesting); everything above is rounded to
 * whole tokens so the footer does not jitter.
 *
 * The value is rounded to one decimal *first*, so 9.99 renders as `10`
 * instead of `10.0` — the same shape 10.0 gets.
 */
export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 10) return rounded.toFixed(1);
  return String(Math.round(rounded));
}

function rateColor(theme: Theme, value: number): string {
  const text = formatRate(value);
  if (value >= FAST_MIN) return theme.fg("success", text);
  if (value >= SLOW_MIN) return theme.fg("warning", text);
  // Slow is not an error — keep it readable but out of the way.
  return theme.fg("dim", text);
}

export function formatStatusLine(theme: Theme, view: RateView): string {
  const label = theme.fg("dim", LABEL);
  if (
    view.rate === undefined ||
    !Number.isFinite(view.rate) ||
    view.rate <= 0
  ) {
    return [label, " ", theme.fg("dim", `${RATE_UNIT} —`)].join("");
  }

  const parts = [
    label,
    " ",
    view.estimated ? theme.fg("dim", "~") : "",
    rateColor(theme, view.rate),
    " ",
    theme.fg("dim", RATE_UNIT),
  ];
  if (
    view.average !== undefined &&
    Number.isFinite(view.average) &&
    view.average > 0
  ) {
    parts.push(
      theme.fg("dim", " · avg "),
      theme.fg("dim", formatRate(view.average)),
    );
  }
  return parts.join("");
}

/** One-line summary for the `/token-rate stats` notification. */
export function formatSummary(summary: RateSummary): string {
  if (summary.count === 0 || !summary.last) return "no completed responses yet";

  const parts = [
    `last ${formatRate(summary.last.tokPerSec)} ${RATE_UNIT}`,
    `avg ${formatRate(summary.average ?? 0)} ${RATE_UNIT}`,
    `peak ${formatRate(summary.peak ?? 0)} ${RATE_UNIT}`,
    `${summary.count} ${summary.count === 1 ? "response" : "responses"}`,
  ];
  if (summary.estimated > 0) {
    parts.push(`${summary.estimated} estimated`);
  }
  return parts.join(" · ");
}
