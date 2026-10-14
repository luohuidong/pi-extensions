/**
 * Shared usage-payload factories for tests.
 *
 * Defaults describe a healthy account: all three windows present with a
 * known reset time. Override only the fields a particular test cares about.
 */

import type { RawUsage, RawWindow } from "../../src/api.ts";

export const NOW = Date.parse("2026-10-14T11:12:10.000Z");

export function makeWindow(overrides: Partial<RawWindow> = {}): RawWindow {
  return {
    status: "ok",
    percent: 0,
    resetsAt: "2026-10-14T13:21:30.000Z",
    ...overrides,
  };
}

export function makeUsage(
  overrides: {
    rolling?: RawWindow;
    weekly?: RawWindow;
    monthly?: RawWindow;
  } = {},
): RawUsage {
  return {
    usage: {
      rolling: overrides.rolling ?? makeWindow(),
      weekly: overrides.weekly ?? makeWindow(),
      monthly: overrides.monthly ?? makeWindow(),
    },
  };
}
