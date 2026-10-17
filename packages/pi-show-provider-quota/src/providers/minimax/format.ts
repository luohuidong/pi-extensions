/**
 * MiniMax status-line and detail formatting — pure functions, no I/O.
 *
 * The rendered shape is
 *
 *   MPlan·5%(11m)·7%(1d9h)
 *
 * where `MPlan`, every `·`, the parentheses and the duration are `dim` and
 * only the percentage carries a color. Percentages are *used* percentages
 * (converted from the API's remaining values in `aggregate.ts`), so the shared
 * 70 / 90 color buckets apply unchanged.
 *
 * The two groups are **positional and unlabelled**: 5h first, then 7d. That
 * order is part of the line's contract — dropping the labels is what keeps the
 * row narrow, so reordering the groups silently changes what the numbers mean.
 * `formatDetail()` is where the window names live.
 */

import { formatDuration, pctColor, type Theme } from "../../core/format.ts";
import type { AggregatedQuota } from "./aggregate.ts";

const TITLE = "MPlan";

// One per-window segment, e.g. "5%(11m)".
function segment(theme: Theme, pct: number, ms: number): string {
  return [
    pctColor(theme, pct),
    theme.fg("dim", "("),
    theme.fg("dim", formatDuration(ms)),
    theme.fg("dim", ")"),
  ].join("");
}

export function formatStatusLine(theme: Theme, q: AggregatedQuota): string {
  return [
    theme.fg("dim", TITLE),
    theme.fg("dim", "·"),
    segment(theme, q.h5Pct, q.h5Ms),
    theme.fg("dim", "·"),
    segment(theme, q.d7Pct, q.d7Ms),
  ].join("");
}

// Width of the window-label column, wide enough for "5h" / "7d".
const DETAIL_LABEL_WIDTH = 2;

export function formatDetail(q: AggregatedQuota): string {
  const rows: [string, number, number][] = [
    ["5h", q.h5Pct, q.h5Ms],
    ["7d", q.d7Pct, q.d7Ms],
  ];
  return [
    "MiniMax Token Plan usage (used %)",
    ...rows.map(
      ([label, pct, ms]) =>
        `  ${label.padEnd(DETAIL_LABEL_WIDTH)}  ${pct}% (${formatDuration(ms)})`,
    ),
  ].join("\n");
}
