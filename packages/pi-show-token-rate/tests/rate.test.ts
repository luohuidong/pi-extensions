/**
 * Token-rate math: char estimation, the per-response tracker, and the
 * session summary.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countContentChars,
  estimateTokensFromChars,
  LIVE_WINDOW_MS,
  type RateSample,
  RateTracker,
  summarize,
} from "../src/rate.ts";
import { expect } from "./helpers/expect.ts";

describe("estimateTokensFromChars", () => {
  it("divides by four and rounds up", () => {
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
    expect(estimateTokensFromChars(1234)).toBe(309);
  });

  it("zeroes out non-positive and non-finite input", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-10)).toBe(0);
    expect(estimateTokensFromChars(Number.NaN)).toBe(0);
    expect(estimateTokensFromChars(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("countContentChars", () => {
  it("counts answer text, thinking text, and tool-call arguments", () => {
    expect(
      countContentChars([
        { type: "text", text: "12345" },
        { type: "thinking", thinking: "123" },
        { type: "toolCall", arguments: { a: "12" } },
      ]),
    ).toBe(5 + 3 + '{"a":"12"}'.length);
  });

  it("ignores blocks without countable text", () => {
    const image = { type: "image", data: "base64", mimeType: "image/png" };
    expect(
      countContentChars([
        image,
        { type: "toolCall" },
        { type: "text", text: "" },
      ]),
    ).toBe(0);
  });

  it("survives unserializable tool arguments", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(countContentChars([{ type: "toolCall", arguments: cyclic }])).toBe(
      0,
    );
  });
});

describe("RateTracker", () => {
  it("returns no rate before anything was observed", () => {
    const tracker = new RateTracker();
    tracker.arm();
    expect(tracker.liveRate()).toBeNull();
    expect(tracker.streaming).toBe(false);
    expect(tracker.armed).toBe(true);
  });

  it("measures the trailing window", () => {
    const tracker = new RateTracker();
    tracker.arm();
    // 5 tokens every 100ms → 50 tok/s across the whole window.
    for (let i = 1; i <= 6; i += 1)
      tracker.observe(1_000 + i * 100, i * 5, "usage");

    // baseline is the first checkpoint, so tokens produced before the first
    // observation are excluded: (30 - 5) tokens over 500ms.
    expect(tracker.liveRate()).toBe(50);
  });

  it("only counts tokens inside the trailing window", () => {
    const tracker = new RateTracker();
    tracker.arm();
    // A steady 10 tok/s for eleven seconds, then a burst of 40 tokens in the
    // last second.
    for (let i = 0; i <= 11; i += 1)
      tracker.observe(i * 1_000, i * 10, "usage");
    expect(tracker.liveRate()).toBe(10);

    tracker.observe(12_000, 150, "usage");
    // Window [9s, 12s] now holds 60 tokens instead of 30.
    expect(tracker.liveRate()).toBe(20);

    // The sample, by contrast, averages the whole generation window.
    const sample = tracker.finish(12_000, 150, "usage");
    assert.ok(sample);
    expect(sample.tokPerSec).toBe(12.5);
  });

  it("ignores non-monotonic stamps and token counters", () => {
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 10, "usage");
    tracker.observe(900, 20, "usage"); // out-of-order stamp
    tracker.observe(1_100, 5, "usage"); // counter reset
    tracker.observe(1_200, 20, "usage");

    expect(tracker.liveRate()).toBe(50); // 10 tokens over 200ms
  });

  it("opens the window on the first observation even without arm()", () => {
    const tracker = new RateTracker();
    tracker.observe(1_000, 5, "usage");
    tracker.observe(1_500, 25, "usage");
    expect(tracker.liveRate()).toBe(40);
  });

  it("has no window source before the first observation", () => {
    const tracker = new RateTracker();
    expect(tracker.windowSource).toBeUndefined();
    tracker.arm();
    expect(tracker.windowSource).toBeUndefined();
  });

  it("keeps the window on the scale it opened with", () => {
    // A provider that starts reporting usage mid-stream, and whose count
    // outruns the chars ÷ 4 estimate, must not be diffed against that
    // baseline: the observation is dropped instead of spiking the rate.
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 100, "estimate");
    tracker.observe(1_500, 500, "estimate");
    tracker.observe(1_700, 900, "usage");

    // 400 tokens over 500ms — unchanged by the dropped observation.
    expect(tracker.liveRate()).toBe(800);
    expect(tracker.windowSource).toBe("estimate");

    // The response still settles on the reported count, without a tilde.
    const sample = tracker.finish(2_000, 900, "usage");
    assert.ok(sample);
    expect(sample.source).toBe("usage");
    expect(sample.tokens).toBe(900);
    expect(tracker.windowSource).toBeUndefined();
  });

  it("returns the generation-window rate from finish()", () => {
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 5, "usage");
    tracker.observe(1_500, 25, "usage");

    const sample = tracker.finish(2_000, 30, "usage");
    assert.ok(sample);
    // Tokens produced inside the window: 30 − 5 over 1000ms.
    expect(sample.tokens).toBe(25);
    expect(sample.elapsedMs).toBe(1_000);
    expect(sample.tokPerSec).toBe(25);
    expect(sample.source).toBe("usage");
    expect(tracker.armed).toBe(false);
    expect(tracker.streaming).toBe(false);
  });

  it("does not subtract an estimate baseline from a reported count", () => {
    // OpenAI-compatible endpoints stream with usage.output = 0 and only report
    // the real total on the final chunk, so the window opens on chars ÷ 4
    // estimates and closes on a usage count.
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 10, "estimate");
    tracker.observe(1_500, 50, "estimate");

    // The estimate baseline (10) is not a usage count, so it must not be
    // subtracted: the whole 60 reported tokens count over the 1000ms window.
    const sample = tracker.finish(2_000, 60, "usage");
    assert.ok(sample);
    expect(sample.tokens).toBe(60);
    expect(sample.elapsedMs).toBe(1_000);
    expect(sample.tokPerSec).toBe(60);
    expect(sample.source).toBe("usage");
  });

  it("still produces a sample when usage lands below the estimate", () => {
    // The same mixed-source case with a real count smaller than the estimate:
    // subtracting would yield a negative delta and silently drop the sample.
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 100, "estimate");

    const sample = tracker.finish(2_000, 8, "usage");
    assert.ok(sample);
    expect(sample.tokens).toBe(8);
    expect(sample.tokPerSec).toBe(8);
  });

  it("produces no sample for an empty or instant response", () => {
    const empty = new RateTracker();
    empty.arm();
    expect(empty.finish(1_000, 0, "usage")).toBeNull();

    const instant = new RateTracker();
    instant.arm();
    instant.observe(1_000, 12, "usage");
    expect(instant.finish(1_000, 12, "usage")).toBeNull();
  });

  it("drops state on abort()", () => {
    const tracker = new RateTracker();
    tracker.arm();
    tracker.observe(1_000, 5, "usage");
    tracker.abort();
    expect(tracker.streaming).toBe(false);
    expect(tracker.liveRate()).toBeNull();
  });

  it("matches the trailing-window definition over a long, dense stream", () => {
    // The tracker prunes incrementally rather than rebuilding its window on
    // every delta, so pin `liveRate()` against the definition it has to
    // reproduce: the newest observation minus the newest observation at/before
    // `now - LIVE_WINDOW_MS`. Thousands of observations cross the compaction
    // threshold many times over, which a per-step rebuild would have masked.
    const observed: { at: number; tokens: number }[] = [];
    const tracker = new RateTracker();
    tracker.arm();

    let tokens = 0;
    // Irregular pacing: gaps that both fall inside and straddle the window, so
    // the baseline advances by one point, by many, and by every point.
    const gaps = [4, 7, 120, 900, 3_100, 11, 260, 2_950, 6];
    let now = 10_000;
    for (let i = 0; i < 5_000; i += 1) {
      now += gaps[i % gaps.length];
      tokens += (i % 5) + 1;
      observed.push({ at: now, tokens });
      tracker.observe(now, tokens, "usage");

      const current = observed[observed.length - 1];
      let baseline = observed[0];
      for (const point of observed) {
        if (point.at <= current.at - LIVE_WINDOW_MS) baseline = point;
        else break;
      }
      const elapsedMs = current.at - baseline.at;
      const delta = current.tokens - baseline.tokens;
      assert.strictEqual(
        tracker.liveRate(),
        elapsedMs <= 0 || delta <= 0 ? null : (delta * 1000) / elapsedMs,
        `liveRate() diverged at observation ${i} (t=${now}, tokens=${tokens})`,
      );
    }

    // The whole generation window still survives the incremental pruning:
    // the first observation counted 1 token, which `finish()` excludes.
    const sample = tracker.finish(now + 50, tokens, "usage");
    assert.ok(sample);
    expect(sample.tokens).toBe(tokens - 1);
    expect(sample.source).toBe("usage");
  });

  it("keeps the live rate readable across a pause longer than the window", () => {
    // A stall longer than the window retires every checkpoint in one go. The
    // baseline advances to the last delta before the pause rather than
    // vanishing, so the first reading afterwards still measures from a real
    // observation instead of going blank.
    const tracker = new RateTracker();
    tracker.arm();
    for (let i = 1; i <= 20; i += 1) tracker.observe(i * 100, i * 10, "usage");
    expect(tracker.liveRate()).toBe(100);

    // 4s after the last delta, so the whole window aged out at once: 300
    // tokens since the pre-pause checkpoint over 7000ms.
    tracker.observe(9_000, 500, "usage");
    expect(tracker.liveRate()).toBe((300 * 1000) / 7_000);
    expect(tracker.streaming).toBe(true);

    // The next delta re-baselines on the post-pause one: 300 tokens / 3500ms.
    tracker.observe(12_500, 800, "usage");
    expect(tracker.liveRate()).toBe((300 * 1000) / 3_500);
  });
});

describe("summarize", () => {
  const sample = (
    tokens: number,
    elapsedMs: number,
    source: "usage" | "estimate" = "usage",
  ): RateSample => ({
    tokens,
    elapsedMs,
    tokPerSec: (tokens * 1000) / elapsedMs,
    source,
  });

  it("reports nothing for an empty history", () => {
    const summary = summarize([]);
    expect(summary.count).toBe(0);
    expect(summary.last).toBeUndefined();
    expect(summary.average).toBeUndefined();
    expect(summary.peak).toBeUndefined();
    expect(summary.estimated).toBe(0);
  });

  it("weights the average by duration, not by response count", () => {
    const summary = summarize([sample(30, 500), sample(15, 300)]);
    expect(summary.count).toBe(2);
    // 45 tokens over 800ms — a plain mean of 60 and 50 would say 55.
    expect(summary.average).toBe(56.25);
    expect(summary.peak).toBe(60);
    expect(summary.last?.tokPerSec).toBe(50);
  });

  it("counts estimated samples", () => {
    const summary = summarize([
      sample(10, 100),
      sample(10, 100, "estimate"),
      sample(10, 100, "estimate"),
    ]);
    expect(summary.estimated).toBe(2);
  });
});
