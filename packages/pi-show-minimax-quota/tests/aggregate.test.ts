import { describe, it } from "node:test";

import { type AggregatedQuota, aggregate } from "../src/aggregate.ts";
import { expect } from "./helpers/expect.ts";
import { makeModel } from "./helpers/models.ts";

describe("aggregate", () => {
  it("returns zeros for empty input", () => {
    expect(aggregate([])).toEqual({ h5Pct: 0, h5Ms: 0, d7Pct: 0, d7Ms: 0 });
  });

  it("uses the first model's 5h remaining percent", () => {
    const result = aggregate([
      makeModel({ current_interval_remaining_percent: 80 }),
      makeModel({ current_interval_remaining_percent: 30 }), // ignored
    ]);
    expect(result.h5Pct).toBe(80);
  });

  it("uses the first model's weekly remaining percent", () => {
    const result = aggregate([
      makeModel({ current_weekly_remaining_percent: 65 }),
      makeModel({ current_weekly_remaining_percent: 10 }), // ignored
    ]);
    expect(result.d7Pct).toBe(65);
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

  it("returns 0 percent when the first model's percent field is null or undefined", () => {
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

  it("returns 0 percent for negative values", () => {
    expect(
      aggregate([makeModel({ current_interval_remaining_percent: -5 })]).h5Pct,
    ).toBe(0);
    expect(
      aggregate([makeModel({ current_weekly_remaining_percent: -1 })]).d7Pct,
    ).toBe(0);
  });

  it("produces the documented example numbers: 5h 20%, 7d 30%", () => {
    // Documented example: `5h 20% (2h35m) 7d 30% (5d8h)`
    const result = aggregate([
      makeModel({
        current_interval_remaining_percent: 20,
        remains_time: 2 * 60 * 60 * 1000 + 35 * 60 * 1000, // 2h35m
        current_weekly_remaining_percent: 30,
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
