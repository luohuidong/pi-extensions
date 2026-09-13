/**
 * TUI formatting — pure functions, no side effects, no I/O.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { AggregatedQuota } from "./aggregate.ts";

export type Theme = ExtensionContext["ui"]["theme"];

// Color bucket boundaries (percent remaining).
const COLOR_GREEN_MIN = 50;
const COLOR_YELLOW_MIN = 20;

// Round to the nearest minute — the spec explicitly drops sub-minute
// precision ("重置时间最小单位为分钟即可").
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";

  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;

  // Match the documented examples:
  //   5d8h    when days > 0  (drop minutes — they're <1% of a day)
  //   2h35m   when only hours + minutes
  //   3m      when only minutes
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function pctColor(theme: Theme, pct: number): string {
  const text = `${Math.round(pct)}%`;
  if (pct >= COLOR_GREEN_MIN) return theme.fg("success", text);
  if (pct >= COLOR_YELLOW_MIN) return theme.fg("warning", text);
  return theme.fg("error", text);
}

// One per-window segment of the status line, e.g. "5h 80% (3h12m)".
// Label + reset use the dim theme color; the percent gets its own bucket
// (success / warning / error via pctColor).
function segment(theme: Theme, label: string, pct: number, ms: number): string {
  return [
    theme.fg("dim", label),
    " ",
    pctColor(theme, pct),
    " ",
    theme.fg("dim", "("),
    theme.fg("dim", formatDuration(ms)),
    theme.fg("dim", ")"),
  ].join("");
}

export function formatStatusLine(theme: Theme, q: AggregatedQuota): string {
  return [
    theme.fg("dim", "MiniMax Token Plan"),
    theme.fg("dim", " · "),
    segment(theme, "5h", q.h5Pct, q.h5Ms),
    theme.fg("dim", " · "),
    segment(theme, "7d", q.d7Pct, q.d7Ms),
  ].join("");
}
