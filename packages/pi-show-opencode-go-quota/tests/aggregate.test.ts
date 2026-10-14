import { describe, it } from "node:test";

import { aggregate } from "../src/aggregate.ts";
import { expect } from "./helpers/expect.ts";
import { makeUsage, makeWindow } from "./helpers/usage.ts";

describe("aggregate", () => {
  it("reads the used percent of all three windows verbatim", () => {
    const result = aggregate(
      makeUsage({
        rolling: makeWindow({ percent: 12 }),
        weekly: makeWindow({ percent: 34 }),
        monthly: makeWindow({ percent: 56 }),
      }),
    );
    expect(result?.rolling.usedPct).toBe(12);
    expect(result?.weekly.usedPct).toBe(34);
    expect(result?.monthly.usedPct).toBe(56);
  });

  it("keeps fractional percentages as returned (no rounding)", () => {
    // The endpoint floors today, but the status bar must never invent a
    // different number than the API reported.
    const result = aggregate(
      makeUsage({ monthly: makeWindow({ percent: 31.7 }) }),
    );
    expect(result?.monthly.usedPct).toBe(31.7);
  });

  it("converts resetsAt into epoch milliseconds", () => {
    const result = aggregate(
      makeUsage({
        rolling: makeWindow({ resetsAt: "2026-10-14T13:21:30.000Z" }),
      }),
    );
    expect(result?.rolling.resetsAtMs).toBe(
      Date.parse("2026-10-14T13:21:30.000Z"),
    );
  });

  it("clamps out-of-range percentages", () => {
    const low = aggregate(makeUsage({ weekly: makeWindow({ percent: -5 }) }));
    expect(low?.weekly.usedPct).toBe(0);

    const high = aggregate(makeUsage({ weekly: makeWindow({ percent: 140 }) }));
    expect(high?.weekly.usedPct).toBe(100);
  });

  it("falls back to an empty window when percent is null, missing or NaN", () => {
    const fromNull = aggregate(
      makeUsage({ weekly: makeWindow({ percent: null }) }),
    );
    expect(fromNull?.weekly).toEqual({ usedPct: 0, resetsAtMs: 0 });

    const fromMissing = aggregate(
      makeUsage({ weekly: makeWindow({ percent: undefined }) }),
    );
    expect(fromMissing?.weekly).toEqual({ usedPct: 0, resetsAtMs: 0 });

    const fromNaN = aggregate(
      makeUsage({ weekly: makeWindow({ percent: Number.NaN }) }),
    );
    expect(fromNaN?.weekly).toEqual({ usedPct: 0, resetsAtMs: 0 });
  });

  it("zeroes resetsAtMs when the timestamp is missing, malformed or non-positive", () => {
    expect(
      aggregate(makeUsage({ rolling: makeWindow({ resetsAt: null }) }))?.rolling
        .resetsAtMs,
    ).toBe(0);
    expect(
      aggregate(makeUsage({ rolling: makeWindow({ resetsAt: "not a date" }) }))
        ?.rolling.resetsAtMs,
    ).toBe(0);
    expect(
      aggregate(
        makeUsage({
          rolling: makeWindow({ resetsAt: "1970-01-01T00:00:00.000Z" }),
        }),
      )?.rolling.resetsAtMs,
    ).toBe(0);
  });

  it("keeps a zero-percent window as real data (no special-casing)", () => {
    // Upstream may fill resetsAt with a now+window placeholder at 0%, but
    // the value is surfaced as-is rather than guessed at.
    const result = aggregate(
      makeUsage({ rolling: makeWindow({ percent: 0 }) }),
    );
    expect(result?.rolling.usedPct).toBe(0);
    expect(result?.rolling.resetsAtMs).toBe(
      Date.parse("2026-10-14T13:21:30.000Z"),
    );
  });

  it("ignores the upstream status marker", () => {
    // A non-"ok" status with a usable percent is still real data.
    const result = aggregate(
      makeUsage({ monthly: makeWindow({ status: "limited", percent: 100 }) }),
    );
    expect(result?.monthly.usedPct).toBe(100);
  });

  it("returns null when no window carries a usable percent", () => {
    expect(aggregate({})).toBeNull();
    expect(aggregate({ usage: {} })).toBeNull();
    expect(
      aggregate({
        usage: {
          rolling: makeWindow({ percent: null }),
          weekly: makeWindow({ percent: undefined }),
          monthly: undefined,
        },
      }),
    ).toBeNull();
  });

  it("returns the windows that do have data when the others do not", () => {
    const result = aggregate({
      usage: { weekly: makeWindow({ percent: 7 }) },
    });
    expect(result?.weekly.usedPct).toBe(7);
    expect(result?.rolling).toEqual({ usedPct: 0, resetsAtMs: 0 });
    expect(result?.monthly).toEqual({ usedPct: 0, resetsAtMs: 0 });
  });
});
