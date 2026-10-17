import { describe, it } from "node:test";

import {
  type AggregatedQuota,
  aggregate,
} from "../../../src/providers/minimax/aggregate.ts";
import { expect } from "../../helpers/expect.ts";
import { makeModel } from "../../helpers/models.ts";

describe("aggregate (MiniMax)", () => {
  it("returns zeros for empty input", () => {
    expect(aggregate([])).toEqual({ h5Pct: 0, h5Ms: 0, d7Pct: 0, d7Ms: 0 });
  });

  it("converts the first model's 5h remaining percent into used percent", () => {
    const result = aggregate([
      makeModel({ current_interval_remaining_percent: 80 }),
      makeModel({ current_interval_remaining_percent: 30 }), // ignored
    ]);
    expect(result.h5Pct).toBe(20);
  });

  it("converts the first model's weekly remaining percent into used percent", () => {
    const result = aggregate([
      makeModel({ current_weekly_remaining_percent: 65 }),
      makeModel({ current_weekly_remaining_percent: 10 }), // ignored
    ]);
    expect(result.d7Pct).toBe(35);
  });

  it("uses the first model's 5h reset time in milliseconds", () => {
    const result = aggregate([
      makeModel({ remains_time: 2 * 60 * 60 * 1000 + 35 * 60 * 1000 }), // 2h35m
      makeModel({ remains_time: 90 * 60 * 1000 }), // ignored — would be smaller
    ]);
    expect(result.h5Ms).toBe(2 * 60 * 60 * 1000 + 35 * 60 * 1000);
  });

  it("uses the first model's weekly reset time in milliseconds", () => {
    const result = aggregate([
      makeModel({
        weekly_remains_time: 5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000, // 5d8h
      }),
      makeModel({ weekly_remains_time: 1 * 24 * 60 * 60 * 1000 }), // ignored
    ]);
    expect(result.d7Ms).toBe(5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
  });

  it("treats a null or missing percent as 0% used", () => {
    const fromNull = aggregate([
      makeModel({
        current_interval_remaining_percent: null,
        current_weekly_remaining_percent: null,
      }),
    ]);
    expect(fromNull.h5Pct).toBe(0);
    expect(fromNull.d7Pct).toBe(0);

    const fromMissing = aggregate([
      makeModel({
        current_interval_remaining_percent: undefined,
        current_weekly_remaining_percent: undefined,
      }),
    ]);
    expect(fromMissing.h5Pct).toBe(0);
    expect(fromMissing.d7Pct).toBe(0);
  });

  it("returns 0 ms when the first model's reset time is zero or negative", () => {
    const result = aggregate([
      makeModel({ remains_time: 0, weekly_remains_time: -1 }),
    ]);
    expect(result.h5Ms).toBe(0);
    expect(result.d7Ms).toBe(0);
  });

  it("clamps the converted used percent into 0–100", () => {
    // remaining > 100 → used clamps up to 0
    expect(
      aggregate([makeModel({ current_interval_remaining_percent: 140 })]).h5Pct,
    ).toBe(0);
    // remaining < 0 → used clamps down to 100
    expect(
      aggregate([makeModel({ current_interval_remaining_percent: -5 })]).h5Pct,
    ).toBe(100);
  });

  it("produces the documented example numbers: 5h 20% used, 7d 30% used", () => {
    // Documented example: `5h 20% (2h35m) 7d 30% (5d8h)` on the used scale,
    // i.e. 80% / 70% remaining from the API.
    const result = aggregate([
      makeModel({
        current_interval_remaining_percent: 80,
        remains_time: 2 * 60 * 60 * 1000 + 35 * 60 * 1000, // 2h35m
        current_weekly_remaining_percent: 70,
        weekly_remains_time: 5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000, // 5d8h
      }),
    ]);
    const expected: AggregatedQuota = {
      h5Pct: 20,
      h5Ms: 2 * 60 * 60 * 1000 + 35 * 60 * 1000,
      d7Pct: 30,
      d7Ms: 5 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
    };
    expect(result).toEqual(expected);
  });
});
