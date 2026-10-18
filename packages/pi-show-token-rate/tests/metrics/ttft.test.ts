/**
 * TTFT metric in isolation: the request anchor, what counts as the first
 * token, and the freeze/keep rules.
 */

import { describe, it } from "node:test";

import { MAX_PLAUSIBLE_TTFT_MS, TtftMetric } from "../../src/metrics/ttft.ts";
import { expect } from "../helpers/expect.ts";
import {
  type AssistantMessage,
  makeAssistantMessage,
  makeTextStart,
  makeTextUpdate,
  makeThinkingStart,
  makeToolcallStart,
  makeToolcallUpdate,
} from "../helpers/messages.ts";
import { theme } from "../helpers/theme.ts";

const START = 1_000;

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return makeAssistantMessage({ timestamp: START, ...overrides });
}

/** The segment as it is painted while a response streams. */
function live(metric: TtftMetric, now: number): string {
  return metric.render(theme, true, now);
}

/** The segment as it is painted once the response is over. */
function idle(metric: TtftMetric, now: number): string {
  return metric.render(theme, false, now);
}

describe("TtftMetric", () => {
  it("measures from the message's request stamp to the first token", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeTextStart(m, 0), START + 840);

    expect(live(metric, START + 840)).toBe(
      "[dim]TTFT[/] [success]840[/][dim]ms[/]",
    );
  });

  it("takes the earliest event when the block opens before the first delta", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeThinkingStart(m, 0), START + 1_200);
    // A later delta cannot move a reading that is already taken.
    metric.onUpdate(makeThinkingStart(m, 0), START + 1_400);

    expect(live(metric, START + 1_400)).toBe(
      "[dim]TTFT[/] [warning]1.2[/][dim]s[/]",
    );
  });

  it("passes one decimal of seconds at the red boundary", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeToolcallStart(m, 0), START + 3_040);

    expect(live(metric, START + 3_040)).toBe(
      "[dim]TTFT[/] [warning]3.0[/][dim]s[/]",
    );
  });

  it("is red above three seconds", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeToolcallUpdate(m, 0, "x"), START + 3_100);

    expect(live(metric, START + 3_100)).toBe(
      "[dim]TTFT[/] [error]3.1[/][dim]s[/]",
    );
  });

  it("does not count an empty delta as a token", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeTextUpdate(m, 0, ""), START + 100);
    expect(live(metric, START + 100)).toBe("[dim]TTFT[/] [dim]— ms[/]");

    metric.onUpdate(makeTextUpdate(m, 0, "hi"), START + 250);
    expect(live(metric, START + 250)).toBe(
      "[dim]TTFT[/] [success]250[/][dim]ms[/]",
    );
  });

  it("measures every assistant response in turn", () => {
    const metric = new TtftMetric();

    const first = message();
    metric.onMessageStart(first);
    metric.onUpdate(makeTextStart(first, 0), START + 500);
    metric.onMessageEnd(first, START + 600);

    const second = message({ timestamp: 10_000 });
    metric.onMessageStart(second);
    metric.onUpdate(makeTextStart(second, 0), 10_000 + 1_500);

    expect(live(metric, 10_000 + 1_500)).toBe(
      "[dim]TTFT[/] [warning]1.5[/][dim]s[/]",
    );
  });

  it("carries the last reading dimmed until the new response starts", () => {
    const metric = new TtftMetric();

    const first = message();
    metric.onMessageStart(first);
    metric.onUpdate(makeTextStart(first, 0), START + 500);
    metric.onMessageEnd(first, START + 600);

    const second = message({ timestamp: 20_000 });
    metric.onMessageStart(second);
    expect(live(metric, 20_000)).toBe("[dim]TTFT[/] [dim]500[/][dim]ms[/]");

    metric.onUpdate(makeTextStart(second, 0), 20_100);
    expect(live(metric, 20_100)).toBe("[dim]TTFT[/] [success]100[/][dim]ms[/]");
  });

  it("refuses a reading beyond the plausible cap", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeTextStart(m, 0), START + MAX_PLAUSIBLE_TTFT_MS + 1);

    expect(live(metric, START + MAX_PLAUSIBLE_TTFT_MS + 1)).toBe(
      "[dim]TTFT[/] [dim]— ms[/]",
    );
  });

  it("refuses a non-positive gap", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);

    metric.onUpdate(makeTextStart(m, 0), START);

    expect(live(metric, START)).toBe("[dim]TTFT[/] [dim]— ms[/]");
  });

  it("freezes the reading, dimmed, when the response ends", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);
    metric.onUpdate(makeTextStart(m, 0), START + 1_240);

    metric.onMessageEnd(m, START + 2_000);

    expect(idle(metric, START + 2_000)).toBe(
      "[dim]TTFT[/] [dim]1.2[/][dim]s[/]",
    );
  });

  it("keeps the previous reading when a response is aborted or errors", () => {
    const metric = new TtftMetric();

    const good = message();
    metric.onMessageStart(good);
    metric.onUpdate(makeTextStart(good, 0), START + 800);
    metric.onMessageEnd(good, START + 900);
    const frozen = idle(metric, START + 900);
    expect(frozen).toBe("[dim]TTFT[/] [dim]800[/][dim]ms[/]");

    for (const stopReason of ["aborted", "error"] as const) {
      const dropped = message({ timestamp: 5_000, stopReason });
      metric.onMessageStart(dropped);
      metric.onUpdate(makeTextStart(dropped, 0), 5_000 + 200);
      metric.onMessageEnd(dropped, 5_000 + 300);

      expect(idle(metric, 5_000 + 300)).toBe(frozen);
    }
  });

  it("shows the placeholder when nothing was ever measured", () => {
    const metric = new TtftMetric();
    const failed = message({ stopReason: "error" });

    metric.onMessageStart(failed);
    metric.onMessageEnd(failed, START + 100);

    expect(idle(metric, START + 100)).toBe("[dim]TTFT[/] [dim]— ms[/]");
  });

  it("clears everything on reset", () => {
    const metric = new TtftMetric();
    const m = message();
    metric.onMessageStart(m);
    metric.onUpdate(makeTextStart(m, 0), START + 500);
    metric.onMessageEnd(m, START + 600);

    metric.reset();

    expect(idle(metric, START + 600)).toBe("[dim]TTFT[/] [dim]— ms[/]");
  });
});
