/**
 * Two-scale live tracker: which window answers, and when it hands over.
 */

import { describe, it } from "node:test";
import { RateTracker } from "../src/rate/index.ts";
import { expect } from "./helpers/expect.ts";

describe("RateTracker", () => {
  it("returns no rate before anything was observed", () => {
    expect(new RateTracker().live(0)).toBeNull();
  });

  it("reports nothing until a scale has two points to subtract", () => {
    const tracker = new RateTracker();
    tracker.observe(1_000, 10, "usage");
    expect(tracker.live(1_000)).toBeNull();
  });

  it("keeps each scale in its own window and prefers usage when it moves", () => {
    // A provider that starts reporting usage mid-stream, at a different scale
    // than the estimate, must not be diffed against the estimate's baseline.
    const tracker = new RateTracker();
    tracker.observe(1_000, 100, "estimate");
    tracker.observe(2_500, 250, "estimate");
    tracker.observe(2_700, 900, "usage");

    // One usage point cannot be timed; the estimate answers — 150 tokens in
    // 1500ms.
    const early = tracker.live(2_700);
    expect(early?.source).toBe("estimate");
    expect(early?.tokPerSec).toBe(100);

    // Once the usage window moves it wins: 500 tokens in 500ms.
    tracker.observe(3_200, 1_400, "usage");
    const late = tracker.live(3_200);
    expect(late?.source).toBe("usage");
    expect(late?.tokPerSec).toBe(1_000);
  });

  it("keeps the live number moving while the provider count stalls", () => {
    // Anthropic reports a non-zero count at the start and only advances it in
    // a terminal event, so the estimate has to keep the number alive.
    const tracker = new RateTracker();
    for (let i = 1; i <= 6; i += 1) {
      const at = 1_000 + i * 200;
      tracker.observe(at, 1, "usage");
      tracker.observe(at, i * 20, "estimate");
    }

    const live = tracker.live(2_200);
    expect(live?.source).toBe("estimate");
    expect(live?.tokPerSec).toBe(100);
  });

  it("hands the live number back when the provider count goes quiet", () => {
    const tracker = new RateTracker();
    tracker.observe(1_000, 10, "usage");
    tracker.observe(2_000, 100, "usage"); // a real 90 tok/s window
    expect(tracker.live(2_000)?.source).toBe("usage");

    // The text keeps streaming, but the provider count is stuck. Long after
    // its window expired the estimate has to answer.
    for (let i = 1; i <= 12; i += 1) {
      tracker.observe(2_000 + i * 200, i * 20, "estimate");
    }
    const stale = tracker.live(5_100);
    expect(stale?.source).toBe("estimate");
    expect(stale?.tokPerSec).toBe(100);

    // A count that starts moving again takes over immediately.
    tracker.observe(5_200, 300, "usage");
    tracker.observe(5_400, 400, "usage");
    expect(tracker.live(5_400)?.source).toBe("usage");
  });

  it("hands the live number back when the provider counter resets", () => {
    const tracker = new RateTracker();
    tracker.observe(1_000, 10, "usage");
    tracker.observe(2_000, 100, "usage");
    expect(tracker.live(2_000)?.source).toBe("usage");

    // The counter restarts below the stale maximum, so every later reading is
    // rejected by the monotonicity guard and the window stops moving.
    tracker.observe(2_200, 5, "usage");
    for (let i = 1; i <= 12; i += 1) {
      tracker.observe(2_000 + i * 200, i * 20, "estimate");
    }
    const live = tracker.live(5_100);
    expect(live?.source).toBe("estimate");
    expect(live?.tokPerSec).toBe(100);
  });

  it("treats an implausible usage window as unmeasurable", () => {
    // A provider that flushes its counter in a burst — 1100 tokens 4ms after
    // the previous reading — would otherwise print 275,000 tok/s.
    const tracker = new RateTracker();
    tracker.observe(1_000, 100, "usage");
    tracker.observe(1_004, 1_200, "usage");
    expect(tracker.live(1_004)).toBeNull();

    // The estimate window still answers with a plausible rate.
    for (let i = 1; i <= 12; i += 1) {
      tracker.observe(1_000 + i * 200, i * 20, "estimate");
    }
    const live = tracker.live(3_400);
    expect(live?.source).toBe("estimate");
    expect(live?.tokPerSec).toBe(100);
  });

  it("drops every checkpoint on reset()", () => {
    const tracker = new RateTracker();
    tracker.observe(1_000, 5, "usage");
    tracker.observe(1_100, 15, "usage");
    expect(tracker.live(1_100)?.tokPerSec).toBe(100);
    tracker.reset();
    expect(tracker.live(1_100)).toBeNull();
  });
});
