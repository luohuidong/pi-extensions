/**
 * Token Plan payload → one 5h / 7d pair.
 *
 * The upstream `/v1/token_plan/remains` endpoint returns one `model_remains`
 * entry per model bucket (e.g. `general`, `video`). Per the Token Plan
 * contract, the **first entry** carries the canonical quota state — that is
 * what we surface:
 *
 *   5h:  first.current_interval_remaining_percent  +  first.remains_time
 *   7d:  first.current_weekly_remaining_percent    +  first.weekly_remains_time
 *
 * The endpoint reports percentages as *remaining*, which is the opposite
 * convention from this extension's unified "used" scale, so each percentage is
 * converted with `100 - remaining` here. That keeps coloring and the detail
 * breakdown consistent across every provider. Reset times arrive in
 * milliseconds, which is also what the shared `formatDuration` wants, so they
 * pass through unchanged.
 */

import type { QuotaModelRemain } from "./api.ts";

export interface AggregatedQuota {
  /** 5h window, used percent (converted from the API's remaining percent). */
  h5Pct: number;
  /** Milliseconds until the 5h window resets. */
  h5Ms: number;
  /** 7d window, used percent (converted from the API's remaining percent). */
  d7Pct: number;
  /** Milliseconds until the 7d window resets. */
  d7Ms: number;
}

// `null` / undefined / NaN / ±Infinity / negative → 0; otherwise the value
// floored at 0. Used for the millisecond durations: aggregate() drops any
// missing or malformed field to 0 so the status line always shows numbers
// instead of crashing the format layer. `Number.isFinite` covers NaN and
// ±Infinity in one check; the JSON payload can't actually carry ±Infinity, but
// the guard is free.
function readPositive(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value))
    return 0;
  return Math.max(0, value);
}

// Converts a server-reported *remaining* percent into the unified *used*
// percent, clamped to 0–100. A missing or malformed field is treated as 0%
// used (i.e. no information) rather than 100%.
function toUsedPercent(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value))
    return 0;
  return Math.min(100, Math.max(0, 100 - value));
}

export function aggregate(models: QuotaModelRemain[]): AggregatedQuota {
  const m = models[0];
  if (!m) return { h5Pct: 0, h5Ms: 0, d7Pct: 0, d7Ms: 0 };

  return {
    h5Pct: toUsedPercent(m.current_interval_remaining_percent),
    h5Ms: readPositive(m.remains_time),
    d7Pct: toUsedPercent(m.current_weekly_remaining_percent),
    d7Ms: readPositive(m.weekly_remains_time),
  };
}
