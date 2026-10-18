/**
 * TPS metric in isolation: window wiring, scale selection, freezing, and the
 * accent colour. The clock is injected so every expectation is exact.
 *
 * Composition with the rest of the row is covered in `../line.test.ts`;
 * formatting in `../format.test.ts`.
 */

import { describe, it } from "node:test";

import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

import { TpsMetric } from "../../src/metrics/tps.ts";
import { expect } from "../helpers/expect.ts";
import {
  type AssistantMessage,
  makeAssistantMessage,
  makeTextUpdate,
  makeThinkingUpdate,
  makeToolcallUpdate,
} from "../helpers/messages.ts";
import { theme } from "../helpers/theme.ts";

interface Clock {
  now: number;
}

/** Feed a response of `steps` deltas, `perStep` tokens each, every 100ms. */
function stream(
  metric: TpsMetric,
  clock: Clock,
  message: AssistantMessage,
  startAt: number,
  steps: number,
  perStep: number,
): void {
  clock.now = startAt;
  metric.onMessageStart(message);
  for (let i = 1; i <= steps; i += 1) {
    clock.now = startAt + i * 100;
    metric.onUpdate(makeTextUpdate(message, i * perStep), clock.now);
  }
}

/** The segment as it is painted while a response streams. */
function live(metric: TpsMetric, clock: Clock): string {
  return metric.render(theme, true, clock.now);
}

/** The segment as it is painted once the response is over. */
function idle(metric: TpsMetric, clock: Clock): string {
  return metric.render(theme, false, clock.now);
}

const GREEN = "[dim]TPS[/] [success]200[/] [dim]tok/s[/]";
const YELLOW = "[dim]TPS[/] [warning]50[/] [dim]tok/s[/]";
const DIM_YELLOW = "[dim]TPS[/] [dim]50[/] [dim]tok/s[/]";
const ESTIMATE_LIVE = "[dim]TPS[/] [success]100[/] [dim]tok/s[/]";
const ESTIMATE_FROZEN = "[dim]TPS[/] [dim]100[/] [dim]tok/s[/]";

describe("TpsMetric", () => {
  it("renders a live rate while the model streams", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };

    // 20 tokens every 100ms; the trailing window sees 200 tok/s.
    stream(metric, clock, makeAssistantMessage(), 1_000, 5, 20);

    expect(live(metric, clock)).toBe(GREEN);
  });

  it("colours a mid rate yellow", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };

    // 5 tokens every 100ms is 50 tok/s, the top of the yellow band.
    stream(metric, clock, makeAssistantMessage(), 1_000, 5, 5);

    expect(live(metric, clock)).toBe(YELLOW);
  });

  it("colours a slow rate red", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    // One token every 400ms is 2.5 tok/s, below the 10 tok/s red boundary.
    clock.now = 1_000;
    metric.onMessageStart(message);
    for (let i = 1; i <= 5; i += 1) {
      clock.now = 1_000 + i * 400;
      metric.onUpdate(makeTextUpdate(message, i, "x"), clock.now);
    }

    expect(live(metric, clock)).toBe("[dim]TPS[/] [error]2.5[/] [dim]tok/s[/]");
  });

  it("keeps the last streaming rate, dimmed, when the response ends", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    stream(metric, clock, message, 1_000, 5, 5);
    expect(live(metric, clock)).toBe(YELLOW);

    metric.onMessageEnd(message, clock.now);
    // The trailing-window reading is frozen as-is; there is no settled average.
    expect(idle(metric, clock)).toBe(DIM_YELLOW);
  });

  it("falls back to the character estimate when no usage is reported", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    // No provider usage: 80 chars per 200ms is 20 tokens at the prose ratio,
    // i.e. 100 tok/s.
    clock.now = 1_000;
    metric.onMessageStart(message);
    for (let i = 1; i <= 8; i += 1) {
      clock.now = 1_000 + i * 200;
      metric.onUpdate(makeTextUpdate(message, 0, "x".repeat(80)), clock.now);
    }
    expect(live(metric, clock)).toBe(ESTIMATE_LIVE);

    clock.now = 2_800;
    metric.onMessageEnd(message, clock.now);
    // The last estimated reading is frozen as-is, dimmed.
    expect(idle(metric, clock)).toBe(ESTIMATE_FROZEN);
  });

  it("weights wide characters as roughly one token each", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    // Chinese thinking at 3 characters per 100ms is ~30 tok/s; dividing
    // everything by four used to read it as 7.5.
    clock.now = 1_000;
    metric.onMessageStart(message);
    for (let i = 1; i <= 15; i += 1) {
      clock.now = 1_000 + i * 100;
      metric.onUpdate(makeThinkingUpdate(message, 0, "先分析"), clock.now);
    }
    expect(live(metric, clock)).toBe(
      "[dim]TPS[/] [warning]30[/] [dim]tok/s[/]",
    );
  });

  it("absorbs a tool call that arrives in one delta", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    // A steady 50 tok/s from the estimate.
    clock.now = 1_000;
    metric.onMessageStart(message);
    for (let i = 1; i <= 10; i += 1) {
      clock.now = 1_000 + i * 200;
      metric.onUpdate(makeTextUpdate(message, 0, "x".repeat(40)), clock.now);
    }
    expect(live(metric, clock)).toBe(
      "[dim]TPS[/] [warning]50[/] [dim]tok/s[/]",
    );

    // The whole command lands in one delta: 4000 chars = 1600 estimated
    // tokens in a single 200ms interval. Only the stream's own pace is
    // credited, so the row moves a little instead of jumping.
    clock.now = 3_200;
    metric.onUpdate(
      makeToolcallUpdate(message, 0, "x".repeat(4_000)),
      clock.now,
    );
    expect(live(metric, clock)).toBe(
      "[dim]TPS[/] [success]55[/] [dim]tok/s[/]",
    );
  });

  it("keeps the estimate live when usage appears mid-stream", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    clock.now = 1_000;
    metric.onMessageStart(message);
    for (let i = 1; i <= 6; i += 1) {
      clock.now = 1_000 + i * 200;
      metric.onUpdate(makeTextUpdate(message, 0, "x".repeat(80)), clock.now);
    }
    expect(live(metric, clock)).toBe(ESTIMATE_LIVE);

    // A single usage reading cannot be timed, so the estimate still answers.
    clock.now = 2_400;
    metric.onUpdate(makeTextUpdate(message, 900, "x".repeat(80)), clock.now);
    expect(live(metric, clock)).toBe(ESTIMATE_LIVE);

    // A second reading makes the provider window measurable, and it wins.
    clock.now = 2_600;
    metric.onUpdate(makeTextUpdate(message, 1_200, "x".repeat(80)), clock.now);
    expect(live(metric, clock)).toBe(
      "[dim]TPS[/] [success]1500[/] [dim]tok/s[/]",
    );
  });

  it("carries the last reading dimmed until the new response is measurable", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    stream(metric, clock, message, 1_000, 3, 10);
    metric.onMessageEnd(message, clock.now);
    expect(idle(metric, clock)).toBe("[dim]TPS[/] [dim]100[/] [dim]tok/s[/]");

    // New response: a single delta opens the window but cannot produce a rate.
    // The previous reading carries over, still dim, until a rate is measurable.
    clock.now = 5_000;
    metric.onMessageStart(message);
    metric.onUpdate(makeTextUpdate(message, 5), clock.now);
    expect(live(metric, clock)).toBe("[dim]TPS[/] [dim]100[/] [dim]tok/s[/]");
  });

  it("shows the placeholder before any rate is measurable", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    clock.now = 1_000;
    metric.onMessageStart(message);
    metric.onUpdate(makeTextUpdate(message, 5), clock.now);

    expect(live(metric, clock)).toBe("[dim]TPS[/] [dim]— tok/s[/]");
  });

  it("freezes each new response's rate in place of the previous one", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    stream(metric, clock, message, 1_000, 5, 5);
    metric.onMessageEnd(message, clock.now);
    expect(idle(metric, clock)).toBe(DIM_YELLOW);

    stream(metric, clock, message, 2_000, 3, 3);
    metric.onMessageEnd(message, clock.now);
    expect(idle(metric, clock)).toBe("[dim]TPS[/] [dim]30[/] [dim]tok/s[/]");
  });

  it("keeps the previous reading when a response is aborted", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const message = makeAssistantMessage();

    stream(metric, clock, message, 1_000, 5, 5);
    metric.onMessageEnd(message, clock.now);
    const frozen = idle(metric, clock);
    expect(frozen).toBe(DIM_YELLOW);

    // ESC mid-stream: pi still emits message_end, at a faster live rate, so a
    // repaint back to the previous reading is observable.
    const aborted = makeAssistantMessage({ stopReason: "aborted" });
    stream(metric, clock, aborted, 2_000, 3, 20);
    metric.onMessageEnd(aborted, clock.now);

    expect(idle(metric, clock)).toBe(frozen);
  });

  it("falls back to the placeholder when nothing was ever measured", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const failed = makeAssistantMessage({ stopReason: "error" });

    stream(metric, clock, failed, 1_000, 3, 10);
    metric.onMessageEnd(failed, clock.now);

    expect(idle(metric, clock)).toBe("[dim]TPS[/] [dim]— tok/s[/]");
  });

  it("ignores non-assistant updates", () => {
    const metric = new TpsMetric();
    const clock: Clock = { now: 0 };
    const assistant = makeAssistantMessage();
    const user = {
      role: "user" as const,
      content: "hi",
      timestamp: 0,
    };

    clock.now = 1_000;
    metric.onMessageStart(assistant);
    const event = makeTextUpdate(assistant, 10) as MessageUpdateEvent;
    metric.onUpdate({ ...event, message: user }, clock.now);

    expect(live(metric, clock)).toBe("[dim]TPS[/] [dim]— tok/s[/]");
  });
});
