/**
 * Token Plan quota → single 5h / 7d line.
 *
 * The upstream `/v1/token_plan/remains` endpoint returns one
 * `model_remains` entry per model bucket (e.g. `general`, `video`). Per
 * the Token Plan contract, the **first entry** carries the canonical
 * quota state — that is what we surface in the TUI:
 *
 *   5h:  first.current_interval_remaining_percent  +  first.remains_time
 *   7d:  first.current_weekly_remaining_percent    +  first.weekly_remains_time
 *
 * Percentages are reported pre-computed by the server; reset times
 * arrive in milliseconds.
 */

import type { QuotaModelRemain } from "./api.ts";

// `null` / undefined / NaN / negative → 0; otherwise the value floored at 0.
// Used for both percentages and millisecond durations: aggregate() drops any
// missing or malformed field to 0 so the status line always shows numbers
// instead of crashing the format layer.
function readPositive(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export interface AggregatedQuota {
  h5Pct: number;
  h5Ms: number;
  d7Pct: number;
  d7Ms: number;
}

export function aggregate(models: QuotaModelRemain[]): AggregatedQuota {
  const m = models[0];
  if (!m) return { h5Pct: 0, h5Ms: 0, d7Pct: 0, d7Ms: 0 };

  return {
    h5Pct: readPositive(m.current_interval_remaining_percent),
    h5Ms: readPositive(m.remains_time),
    d7Pct: readPositive(m.current_weekly_remaining_percent),
    d7Ms: readPositive(m.weekly_remains_time),
  };
}
