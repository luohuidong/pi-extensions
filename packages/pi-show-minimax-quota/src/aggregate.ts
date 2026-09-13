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

// Server-reported percentages should be 0–100; clamp with headroom in case
// the upstream ever ships a boosted value (e.g. a >100% grace window).
const PERCENT_CLAMP_MAX = 200;

export interface AggregatedQuota {
  h5Pct: number;
  h5Ms: number;
  d7Pct: number;
  d7Ms: number;
}

function clampPercent(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PERCENT_CLAMP_MAX, value));
}

function normalizeMs(value: number | null | undefined): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function aggregate(models: QuotaModelRemain[]): AggregatedQuota {
  const m = models[0];
  if (!m) return { h5Pct: 0, h5Ms: 0, d7Pct: 0, d7Ms: 0 };

  return {
    h5Pct: clampPercent(m.current_interval_remaining_percent),
    h5Ms: normalizeMs(m.remains_time),
    d7Pct: clampPercent(m.current_weekly_remaining_percent),
    d7Ms: normalizeMs(m.weekly_remains_time),
  };
}
