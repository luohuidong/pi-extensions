/**
 * Formatting primitives shared by every provider — pure functions, no side
 * effects, no I/O.
 *
 * Layout is deliberately *not* shared: each vendor decides its own window
 * labels, order, and spacing inside its own `format.ts`. What is shared is the
 * duration rendering and the color bucket, which every provider agrees on.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Theme = ExtensionContext["ui"]["theme"];

// Color bucket boundaries, expressed as *used* percent. Every provider
// normalizes its own payload to "used" before formatting, so one set of
// thresholds covers all of them.
const COLOR_YELLOW_MIN = 70;
const COLOR_RED_MIN = 90;

// Round to the nearest minute — sub-minute precision is noise in a status
// bar, and the value is a snapshot taken at fetch time anyway.
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";

  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;

  //   5d8h    when days > 0  (minutes dropped — they're <1% of a day)
  //   2h35m   when only hours + minutes
  //   3m      when only minutes
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

/**
 * Colors a *used* percentage: green while there is plenty of headroom,
 * yellow from 70%, red from 90%.
 */
export function pctColor(theme: Theme, usedPct: number): string {
  const text = `${usedPct}%`;
  if (usedPct >= COLOR_RED_MIN) return theme.fg("error", text);
  if (usedPct >= COLOR_YELLOW_MIN) return theme.fg("warning", text);
  return theme.fg("success", text);
}
