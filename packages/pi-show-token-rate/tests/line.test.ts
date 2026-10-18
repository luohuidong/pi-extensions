/**
 * Status-line controller: the composed row, throttling, and the toggle.
 *
 * Metrics are exercised in isolation in `tests/metrics/`; this file checks the
 * wiring between them and the footer. The clock is injected so every
 * expectation is exact instead of timing-dependent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { MetricsLine } from "../src/line.ts";
import { expect } from "./helpers/expect.ts";
import {
  type AssistantMessage,
  makeAssistantMessage,
  makeMessageEnd,
  makeMessageStart,
  makeTextUpdate,
} from "./helpers/messages.ts";
import { theme } from "./helpers/theme.ts";

interface Write {
  key: string;
  text: string | undefined;
}

function makeCtx(): { ctx: ExtensionContext; writes: Write[] } {
  const writes: Write[] = [];
  const ctx = {
    hasUI: true,
    ui: {
      theme,
      setStatus: (key: string, text: string | undefined) => {
        writes.push({ key, text });
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, writes };
}

function lastText(writes: Write[]): string | undefined {
  return writes[writes.length - 1]?.text;
}

/**
 * Feed a response of `steps` deltas, `perStep` tokens each, every 100ms. The
 * message's request stamp is the streaming start, so TTFT is the first delta's
 * 100ms gap.
 */
function stream(
  line: MetricsLine,
  ctx: ExtensionContext,
  clock: { now: number },
  message: AssistantMessage,
  startAt: number,
  steps: number,
  perStep: number,
): void {
  clock.now = startAt;
  line.onMessageStart(ctx, { ...message, timestamp: startAt });
  for (let i = 1; i <= steps; i += 1) {
    clock.now = startAt + i * 100;
    line.onUpdate(ctx, makeTextUpdate(message, i * perStep));
  }
}

const LIVE_ROW =
  "[dim]TPS[/] [success]200[/] [dim]tok/s[/] [dim]·[/] [dim]TTFT[/] [success]100[/][dim]ms[/]";
const FROZEN_ROW =
  "[dim]TPS[/] [dim]200[/] [dim]tok/s[/] [dim]·[/] [dim]TTFT[/] [dim]100[/][dim]ms[/]";
const EMPTY_ROW =
  "[dim]TPS[/] [dim]— tok/s[/] [dim]·[/] [dim]TTFT[/] [dim]— ms[/]";

describe("MetricsLine", () => {
  it("clears any leftover row on session start", () => {
    const { ctx, writes } = makeCtx();
    new MetricsLine().start(ctx);
    expect(writes).toEqual([{ key: "token-rate", text: undefined }]);
  });

  it("paints TPS then TTFT on one row while the model streams", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    line.start(ctx);

    // 20 tokens every 100ms; the trailing window sees 200 tok/s, and the first
    // delta arrives 100ms after the request stamp.
    stream(line, ctx, clock, makeAssistantMessage(), 1_000, 5, 20);

    expect(lastText(writes)).toBe(LIVE_ROW);
  });

  it("paints the first token's TTFT on the first update", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    clock.now = 1_000;
    line.onMessageStart(ctx, { ...message, timestamp: 1_000 });
    clock.now = 1_250;
    line.onUpdate(ctx, makeTextUpdate(message, 6));

    expect(lastText(writes)).toBe(
      "[dim]TPS[/] [dim]— tok/s[/] [dim]·[/] [dim]TTFT[/] [success]250[/][dim]ms[/]",
    );
  });

  it("dims both readings once the response ends", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 5, 20);
    clock.now = 1_600;
    line.onMessageEnd(ctx, makeMessageEnd(message, 100).message);

    expect(lastText(writes)).toBe(FROZEN_ROW);
  });

  it("shows both placeholders when a response measured nothing", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const failed = makeAssistantMessage({ stopReason: "error" });

    clock.now = 1_000;
    line.onMessageStart(ctx, { ...failed, timestamp: 1_000 });
    clock.now = 1_100;
    line.onMessageEnd(ctx, makeMessageEnd(failed).message);

    expect(lastText(writes)).toBe(EMPTY_ROW);
  });

  it("refreshes TTFT for every assistant response in a turn", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);

    // Tool-call turn: first request, then a second one with a longer TTFT.
    stream(line, ctx, clock, makeAssistantMessage(), 1_000, 3, 10);
    expect(lastText(writes)).toContain("[success]100[/][dim]ms[/]");

    clock.now = 5_000;
    line.onMessageEnd(ctx, makeMessageEnd(makeAssistantMessage(), 30).message);
    stream(line, ctx, clock, makeAssistantMessage(), 6_000, 3, 10);
    expect(lastText(writes)).toContain("[success]100[/][dim]ms[/]");
  });

  it("throttles writes while a response streams", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    clock.now = 1_000;
    line.onMessageStart(ctx, { ...message, timestamp: 1_000 });
    for (let i = 1; i <= 30; i += 1) {
      clock.now = 1_000 + i * 10;
      line.onUpdate(ctx, makeTextUpdate(message, i * 10));
    }

    const painted = writes.filter((write) => write.text !== undefined);
    assert.ok(painted.length >= 1);
    assert.ok(
      painted.length <= 3,
      `expected <= 3 writes, got ${painted.length}`,
    );
  });

  it("toggles the whole row off and back on", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    const frozen = lastText(writes);
    assert.ok(frozen);

    expect(line.toggle(ctx)).toBe(false);
    expect(lastText(writes)).toBeUndefined();

    // Updates while hidden stay hidden…
    stream(line, ctx, clock, message, 2_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    expect(lastText(writes)).toBeUndefined();

    // …and toggling back on repaints the reading.
    expect(line.toggle(ctx)).toBe(true);
    expect(lastText(writes)).toBe(frozen);
  });

  it("stops clearing the row while it is already hidden", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    expect(line.toggle(ctx)).toBe(false);
    writes.length = 0;

    stream(line, ctx, clock, message, 2_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);

    expect(writes).toEqual([]);
  });

  it("forgets both readings on session start", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new MetricsLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);

    line.start(ctx);
    expect(lastText(writes)).toBeUndefined();

    const failed = makeAssistantMessage({ stopReason: "error" });
    clock.now = 5_000;
    line.onMessageStart(ctx, { ...failed, timestamp: 5_000 });
    clock.now = 5_100;
    line.onMessageEnd(ctx, makeMessageEnd(failed).message);
    expect(lastText(writes)).toBe(EMPTY_ROW);
  });

  it("ignores non-assistant messages", () => {
    const { ctx, writes } = makeCtx();
    const line = new MetricsLine(() => 1_000);
    line.start(ctx);
    writes.length = 0;

    const user = { role: "user" as const, content: "hi", timestamp: 0 };
    line.onMessageStart(ctx, user);
    line.onMessageEnd(ctx, user);

    expect(writes).toEqual([]);
  });

  it("does nothing without a UI", () => {
    const writes: Write[] = [];
    const ctx = {
      hasUI: false,
      ui: {
        theme,
        setStatus: (key: string, text: string | undefined) =>
          writes.push({ key, text }),
      },
    } as unknown as ExtensionContext;

    const line = new MetricsLine(() => 1_000);
    const message = makeAssistantMessage();
    line.start(ctx);
    line.onMessageStart(ctx, makeMessageStart(message).message);
    line.onUpdate(ctx, makeTextUpdate(message, 10));
    line.onMessageEnd(ctx, makeMessageEnd(message, 10).message);

    expect(writes).toEqual([]);
  });
});
