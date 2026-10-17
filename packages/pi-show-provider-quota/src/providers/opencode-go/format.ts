/**
 * OpenCode Go status-line and detail formatting — pure functions, no I/O.
 *
 * The rendered shape is
 *
 *   Go·12%(2h35m)·6%(4d12h)·3%(28d20h)
 *
 * where `Go`, every `·`, the parentheses and the duration are `dim` and only
 * the percentage carries a color.
 *
 * The three groups are **positional and unlabelled**: rolling, then weekly,
 * then monthly. That order is the line's public contract — the labels were
 * dropped to keep the status bar narrow, so reordering the groups silently
 * changes what the numbers mean. `formatDetail()` renders the labelled
 * breakdown the `/show-provider-quota` command prints for anyone who has not
 * memorised the order.
 *
 * Percentages are *used* percentages, matching the opencode dashboard
 * convention and this extension's unified scale, so the shared 70 / 90 color
 * buckets apply directly.
 */

import { formatDuration, pctColor, type Theme } from "../../core/format.ts";
import type { AggregatedQuota, QuotaWindow } from "./aggregate.ts";

// Window order for the labelled breakdown. Kept in the same order as the
// status line so the two views read alike.
const DETAIL_WINDOWS: readonly (readonly [keyof AggregatedQuota, string])[] = [
  ["rolling", "Rolling"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

// One per-window segment, e.g. "1%(3h28m)". The reset countdown is omitted
// entirely when the window has no usable `resetsAt`.
function segment(theme: Theme, win: QuotaWindow, now: number): string {
  const parts = [pctColor(theme, win.usedPct)];
  if (win.resetsAtMs > 0) {
    const remainingMs = Math.max(0, win.resetsAtMs - now);
    parts.push(
      theme.fg("dim", "("),
      theme.fg("dim", formatDuration(remainingMs)),
      theme.fg("dim", ")"),
    );
  }
  return parts.join("");
}

/**
 * Assembles the full status line.
 *
 * `now` is passed in rather than read from the clock so the countdown is
 * deterministic in tests. It is the *fetch* time: because this extension never
 * polls, the rendered countdown is a snapshot that stays put until the next
 * refresh.
 */
export function formatStatusLine(
  theme: Theme,
  quota: AggregatedQuota,
  now: number,
): string {
  return [
    theme.fg("dim", "Go"),
    theme.fg("dim", "·"),
    segment(theme, quota.rolling, now),
    theme.fg("dim", "·"),
    segment(theme, quota.weekly, now),
    theme.fg("dim", "·"),
    segment(theme, quota.monthly, now),
  ].join("");
}

// Label column width for the detail breakdown; wide enough for "Monthly".
const DETAIL_LABEL_WIDTH = 8;

/**
 * Renders the labelled breakdown shown by `/show-provider-quota`.
 *
 * Plain text (no theme colors) because it is delivered through
 * `ctx.ui.notify`, which paints the whole message itself. This is the
 * counterpart to the unlabelled status line: the same three windows, in the
 * same order, but with the names spelled out.
 */
export function formatDetail(quota: AggregatedQuota, now: number): string {
  const rows = DETAIL_WINDOWS.map(([key, label]) => {
    const win = quota[key];
    const reset =
      win.resetsAtMs > 0
        ? ` (${formatDuration(Math.max(0, win.resetsAtMs - now))})`
        : "";
    return `  ${label.padEnd(DETAIL_LABEL_WIDTH)}${win.usedPct}%${reset}`;
  });
  return ["OpenCode Go usage (used %)", ...rows].join("\n");
}
