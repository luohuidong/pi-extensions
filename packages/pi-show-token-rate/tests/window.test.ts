/**
 * One scale's trailing window: windowing, monotonicity, and the credit guards.
 */

import { describe, it } from "node:test";
import {
  BURST_TOLERANCE,
  ESTIMATE_GUARD,
  LIVE_WINDOW_MS,
  MIN_CREDIT_TPS,
  MIN_ESTIMATE_WINDOW_MS,
  TokenWindow,
  USAGE_GUARD,
} from "../src/rate/index.ts";
import { expect } from "./helpers/expect.ts";

/** Reports the raw count, never capped — the provider scale. */
function measured(): TokenWindow {
  return new TokenWindow(USAGE_GUARD);
}

/** Reports arriving characters, capped — the estimate scale. */
function estimated(): TokenWindow {
  return new TokenWindow(ESTIMATE_GUARD);
}

describe("TokenWindow", () => {
  it("returns nothing before anything was observed", () => {
    expect(measured().rate(0)).toBeNull();
  });

  it("reports nothing until it has two points to subtract", () => {
    const window = measured();
    window.observe(1_000, 10);
    expect(window.rate(1_000)).toBeNull();
  });

  it("measures the trailing window", () => {
    const window = measured();
    window.observe(0, 0);
    window.observe(100, 10);
    window.observe(200, 20);
    window.observe(300, 30);
    // The first observation only opens the window: 30 tokens over 300ms.
    expect(window.rate(300)).toBe(100);
  });

  it("excludes tokens produced before the first observation", () => {
    const window = measured();
    // A provider that reports a count of 1000 partway through does not let
    // that count count as progress.
    window.observe(1_000, 1_000);
    window.observe(1_500, 1_020);
    expect(window.rate(1_500)).toBe(40);
  });

  it("ignores non-monotonic stamps and counter resets", () => {
    const window = measured();
    window.observe(1_000, 10);
    window.observe(900, 20); // out-of-order stamp
    window.observe(1_100, 5); // counter reset
    window.observe(1_200, 20);
    expect(window.rate(1_200)).toBe(50);
  });

  it("only counts tokens inside the window", () => {
    const window = measured();
    for (let i = 0; i <= 11; i += 1) window.observe(i * 1_000, i * 10);
    expect(window.rate(11_000)).toBe(10);

    // 40 more tokens inside the last second: window [9s, 12s] holds 60.
    window.observe(12_000, 150);
    expect(window.rate(12_000)).toBe(20);
  });

  it("keeps measuring after a pause longer than the window", () => {
    const window = measured();
    for (let i = 1; i <= 20; i += 1) window.observe(i * 100, i * 10);
    expect(window.rate(2_000)).toBe(100);

    // Everything aged out at once; the newest retired point is the baseline.
    window.observe(9_000, 500);
    expect(window.rate(9_000)).toBe((300 * 1000) / 7_000);
  });

  it("goes unmeasurable once its newest point leaves the window", () => {
    const window = measured();
    window.observe(1_000, 10);
    window.observe(1_100, 20);
    expect(window.rate(4_100)).toBeNull();
    expect(window.rate(1_100)).toBe(100);
  });

  it("waits a full second of history on the estimate scale", () => {
    const window = estimated();
    window.observe(1_000, 10);
    window.observe(1_500, 60);
    expect(window.rate(1_500)).toBeNull();

    window.observe(2_200, 130);
    // 120 credited tokens over 1200ms.
    expect(window.rate(2_200)).toBe(100);
  });

  it("refuses one delta's worth of buffered tokens", () => {
    const window = estimated();
    // 4000 tokens in one 100ms interval. The window has no pace of its own
    // yet, so the floor applies: only 100ms worth of it is credited.
    window.observe(1_000, 10);
    window.observe(1_100, 4_010);
    window.observe(2_100, 4_110);
    // 10 flushed tokens plus the 100 real ones, over 1100ms.
    expect(window.rate(2_100)).toBe(100);
  });

  it("follows a genuinely fast stream without throttling it", () => {
    const window = estimated();
    // A steady 400 tok/s from the start. The ceiling follows the window's own
    // *raw* pace, so the reading is not held near the floor while it ramps.
    window.observe(1_000, 0);
    for (let i = 1; i <= 31; i += 1) window.observe(1_000 + i * 100, i * 40);
    // Once the (floored) first interval has slid out, the real 400 shows.
    expect(window.rate(4_100)).toBe(400);
  });

  it("scales the credit ceiling with the stream's own pace", () => {
    const window = estimated();
    // Two seconds of a genuine 100 tok/s.
    window.observe(0, 0);
    window.observe(1_000, 100);
    window.observe(2_000, 200);
    expect(window.rate(2_000)).toBe(100);

    // A stream that really accelerates may only double per interval, so the
    // reading climbs instead of jumping.
    window.observe(3_000, 600);
    expect(window.rate(3_000)).toBe((400 * 1000) / 3_000);

    // Sustained, it reaches the real rate as the window turns over.
    for (let i = 1; i <= 8; i += 1) {
      window.observe(3_000 + i * 1_000, 600 + i * 400);
    }
    const converged = window.rate(11_000) ?? 0;
    expect(converged).toBeGreaterThan(390);
    expect(converged <= 400).toBe(true);
  });

  it("matches the raw trailing-window definition on a dense stream", () => {
    // `measured()` never credits anything but the raw count, so this pins the
    // incremental pruning against the definition it has to reproduce.
    const points: { at: number; tokens: number }[] = [];
    const window = measured();

    let tokens = 0;
    const gaps = [4, 7, 120, 900, 3_100, 11, 260, 2_950, 6];
    let now = 10_000;
    for (let i = 0; i < 4_000; i += 1) {
      now += gaps[i % gaps.length];
      tokens += (i % 5) + 1;
      points.push({ at: now, tokens });
      window.observe(now, tokens);

      assertRate(window.rate(now), expectedRate(), i);
    }

    function expectedRate(): number | null {
      const current = points[points.length - 1];
      if (!current || current.at <= now - LIVE_WINDOW_MS) return null;
      let baseline = points[0];
      for (const point of points) {
        if (point.at <= current.at - LIVE_WINDOW_MS) baseline = point;
        else break;
      }
      const elapsed = current.at - baseline.at;
      const delta = current.tokens - baseline.tokens;
      return elapsed <= 0 || delta <= 0 ? null : (delta * 1000) / elapsed;
    }

    function assertRate(
      actual: number | null,
      expected: number | null,
      step: number,
    ): void {
      if (expected === null) {
        expect(actual).toBeNull();
        return;
      }
      if (actual === null || Math.abs(actual - expected) > 1e-9) {
        throw new Error(
          `step ${step}: expected ${expected}, got ${actual ?? "null"}`,
        );
      }
    }
  });

  it("matches the guarded estimate definition on a dense stream", () => {
    // Recomputes the credited window from the definition on every step, so
    // pruning and the credit ceiling cannot drift apart.
    const points: { at: number; raw: number; credited: number }[] = [];
    const window = estimated();

    let raw = 0;
    let prevAt: number | undefined;
    let prevRaw = 0;
    let credited = 0;
    const gaps = [4, 7, 120, 900, 3_100, 11, 260, 2_950, 6];
    let now = 10_000;
    for (let i = 0; i < 2_500; i += 1) {
      now += gaps[i % gaps.length];
      raw += i % 9 === 0 ? 4_000 : (i % 5) + 1;

      const ceiling = Math.max(
        MIN_CREDIT_TPS,
        (prevAt === undefined ? 0 : (rawRate() ?? 0)) * BURST_TOLERANCE,
      );
      credited +=
        prevAt === undefined
          ? 0
          : Math.min(raw - prevRaw, ((now - prevAt) * ceiling) / 1000);
      points.push({ at: now, raw, credited });
      prevAt = now;
      prevRaw = raw;
      window.observe(now, raw);

      const expected = guardedRate();
      const actual = window.rate(now);
      if (expected === null) {
        expect(actual).toBeNull();
      } else if (actual === null || Math.abs(actual - expected) > 1e-9) {
        throw new Error(
          `step ${i}: expected ${expected}, got ${actual ?? "null"}`,
        );
      }
    }

    function rawRate(): number | null {
      // Evaluated at the newest checkpoint, so it is always fresh. Mirrors
      // `#rawRate(last.at)` in the implementation.
      const current = points[points.length - 1];
      if (!current) return null;
      let baseline = points[0];
      for (const point of points) {
        if (point.at <= current.at - LIVE_WINDOW_MS) baseline = point;
        else break;
      }
      const elapsed = current.at - baseline.at;
      const delta = current.raw - baseline.raw;
      return elapsed <= 0 || delta <= 0 ? null : (delta * 1000) / elapsed;
    }

    function guardedRate(): number | null {
      const current = points[points.length - 1];
      if (!current) return null;
      let baseline = points[0];
      for (const point of points) {
        if (point.at <= current.at - LIVE_WINDOW_MS) baseline = point;
        else break;
      }
      const elapsed = current.at - baseline.at;
      const delta = current.credited - baseline.credited;
      return elapsed < MIN_ESTIMATE_WINDOW_MS || elapsed <= 0 || delta <= 0
        ? null
        : (delta * 1000) / elapsed;
    }
  });
});
