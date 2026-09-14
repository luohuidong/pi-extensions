/**
 * Shared `QuotaModelRemain` factory for tests.
 *
 * Defaults represent a healthy "general" model with full data on both
 * windows; override only the fields a particular test cares about.
 */

import type { QuotaModelRemain } from "../../src/api.ts";

export function makeModel(
  overrides: Partial<QuotaModelRemain> = {},
): QuotaModelRemain {
  return {
    remains_time: 2 * 60 * 60 * 1000,
    weekly_remains_time: 6 * 24 * 60 * 60 * 1000,
    current_interval_remaining_percent: 90,
    current_weekly_remaining_percent: 90,
    ...overrides,
  };
}
