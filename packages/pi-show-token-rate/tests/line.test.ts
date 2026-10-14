/**
 * Status-line controller: streaming, throttling, freezing, and the toggle.
 *
 * The clock is injected so every expectation below is exact instead of
 * timing-dependent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TokenRateLine } from "../src/line.ts";
import { expect } from "./helpers/expect.ts";
import {
  type AssistantMessage,
  makeAssistantMessage,
  makeMessageEnd,
  makeMessageStart,
  makeTextUpdate,
  makeThinkingUpdate,
  makeToolcallUpdate,
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

/** Feed a response of `steps` deltas, `perStep` tokens each, every 100ms. */
function stream(
  line: TokenRateLine,
  ctx: ExtensionContext,
  clock: { now: number },
  message: AssistantMessage,
  startAt: number,
  steps: number,
  perStep: number,
): void {
  clock.now = startAt;
  line.onMessageStart(ctx, makeMessageStart(message).message);
  for (let i = 1; i <= steps; i += 1) {
    clock.now = startAt + i * 100;
    line.onUpdate(ctx, makeTextUpdate(message, i * perStep));
  }
}

const GREEN = "[success]⚡[/] [success]200[/] [dim]tok/s[/]";
const YELLOW = "[success]⚡[/] [warning]50[/] [dim]tok/s[/]";
const DIM_YELLOW = "[dim]⚡[/] [dim]50[/] [dim]tok/s[/]";
const ESTIMATE_LIVE = "[success]⚡[/] [success]100[/] [dim]tok/s[/]";
const ESTIMATE_FROZEN = "[dim]⚡[/] [dim]100[/] [dim]tok/s[/]";

describe("TokenRateLine", () => {
  it("clears any leftover row on session start", () => {
    const { ctx, writes } = makeCtx();
    new TokenRateLine().start(ctx);
    expect(writes).toEqual([{ key: "token-rate", text: undefined }]);
  });

  it("renders a live rate while the model streams", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    line.start(ctx);

    // 20 tokens every 100ms; the trailing window sees 200 tok/s.
    stream(line, ctx, clock, makeAssistantMessage(), 1_000, 5, 20);

    expect(lastText(writes)).toBe(GREEN);
  });

  it("colours a mid rate yellow", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    line.start(ctx);

    // 5 tokens every 100ms is 50 tok/s, the top of the yellow band.
    stream(line, ctx, clock, makeAssistantMessage(), 1_000, 5, 5);

    expect(lastText(writes)).toBe(YELLOW);
  });

  it("colours a slow rate red", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // One token every 400ms is 2.5 tok/s, below the 10 tok/s red boundary.
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 5; i += 1) {
      clock.now = 1_000 + i * 400;
      line.onUpdate(ctx, makeTextUpdate(message, i, "x"));
    }

    expect(lastText(writes)).toBe("[success]⚡[/] [error]2.5[/] [dim]tok/s[/]");
  });

  it("keeps the last streaming rate, dimmed, when the response ends", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 5, 5);
    expect(lastText(writes)).toBe(YELLOW);

    line.onMessageEnd(ctx, makeMessageEnd(message, 50).message);
    // The trailing-window reading is frozen as-is; there is no settled average.
    expect(lastText(writes)).toBe(DIM_YELLOW);
  });

  it("falls back to the character estimate when no usage is reported", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // No provider usage: 80 chars per 200ms is 20 tokens at the prose ratio,
    // i.e. 100 tok/s.
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 8; i += 1) {
      clock.now = 1_000 + i * 200;
      line.onUpdate(ctx, makeTextUpdate(message, 0, "x".repeat(80)));
    }
    expect(lastText(writes)).toBe(ESTIMATE_LIVE);

    clock.now = 2_800;
    line.onMessageEnd(ctx, makeMessageEnd(message, 0).message);
    // The last estimated reading is frozen as-is, dimmed.
    expect(lastText(writes)).toBe(ESTIMATE_FROZEN);
  });

  it("weights wide characters as roughly one token each", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // Chinese thinking at 3 characters per 100ms is ~30 tok/s; dividing
    // everything by four used to read it as 7.5.
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 15; i += 1) {
      clock.now = 1_000 + i * 100;
      line.onUpdate(ctx, makeThinkingUpdate(message, 0, "先分析"));
    }
    expect(lastText(writes)).toBe(
      "[success]⚡[/] [warning]30[/] [dim]tok/s[/]",
    );
  });

  it("absorbs a tool call that arrives in one delta", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // A steady 50 tok/s from the estimate.
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 10; i += 1) {
      clock.now = 1_000 + i * 200;
      line.onUpdate(ctx, makeTextUpdate(message, 0, "x".repeat(40)));
    }
    expect(lastText(writes)).toBe(
      "[success]⚡[/] [warning]50[/] [dim]tok/s[/]",
    );

    // The whole command lands in one delta: 4000 chars = 1600 estimated
    // tokens in a single 200ms interval. Only the stream's own pace is
    // credited, so the row moves a little instead of jumping.
    clock.now = 3_200;
    line.onUpdate(ctx, makeToolcallUpdate(message, 0, "x".repeat(4_000)));
    expect(lastText(writes)).toBe(
      "[success]⚡[/] [success]55[/] [dim]tok/s[/]",
    );
  });

  it("keeps the estimate live when usage appears mid-stream", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 6; i += 1) {
      clock.now = 1_000 + i * 200;
      line.onUpdate(ctx, makeTextUpdate(message, 0, "x".repeat(80)));
    }
    expect(lastText(writes)).toBe(ESTIMATE_LIVE);

    // A single usage reading cannot be timed, so the estimate still answers.
    clock.now = 2_400;
    line.onUpdate(ctx, makeTextUpdate(message, 900, "x".repeat(80)));
    expect(lastText(writes)).toBe(ESTIMATE_LIVE);

    // A second reading makes the provider window measurable, and it wins.
    clock.now = 2_600;
    line.onUpdate(ctx, makeTextUpdate(message, 1_200, "x".repeat(80)));
    expect(lastText(writes)).toBe(
      "[success]⚡[/] [success]1500[/] [dim]tok/s[/]",
    );
  });

  it("keeps the last reading dimmed under a green marker until measurable", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    expect(lastText(writes)).toBe("[dim]⚡[/] [dim]100[/] [dim]tok/s[/]");

    // New response: a single delta opens the window but cannot produce a rate.
    // The marker still turns green; the carried-over reading stays dim.
    clock.now = 5_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    line.onUpdate(ctx, makeTextUpdate(message, 5));
    expect(lastText(writes)).toBe("[success]⚡[/] [dim]100[/] [dim]tok/s[/]");
  });

  it("paints the marker green before any rate is measurable", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    line.onUpdate(ctx, makeTextUpdate(message, 5));

    expect(lastText(writes)).toBe("[success]⚡[/] [dim]tok/s —[/]");
  });

  it("freezes each new response's rate in place of the previous one", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 5, 5);
    line.onMessageEnd(ctx, makeMessageEnd(message, 25).message);
    expect(lastText(writes)).toBe(DIM_YELLOW);

    stream(line, ctx, clock, message, 2_000, 3, 3);
    line.onMessageEnd(ctx, makeMessageEnd(message, 9).message);
    expect(lastText(writes)).toBe("[dim]⚡[/] [dim]30[/] [dim]tok/s[/]");
  });

  it("keeps the previous reading when a response is aborted", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 5, 5);
    line.onMessageEnd(ctx, makeMessageEnd(message, 50).message);
    const frozen = lastText(writes);
    expect(frozen).toBe(DIM_YELLOW);

    // ESC mid-stream: pi still emits message_end, at a faster live rate, so a
    // repaint back to the previous reading is observable.
    const aborted = makeAssistantMessage({ stopReason: "aborted" });
    stream(line, ctx, clock, aborted, 2_000, 3, 20);
    line.onMessageEnd(ctx, makeMessageEnd(aborted).message);

    expect(lastText(writes)).toBe(frozen);
  });

  it("falls back to the placeholder when nothing was ever measured", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const failed = makeAssistantMessage({ stopReason: "error" });

    stream(line, ctx, clock, failed, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(failed).message);

    expect(lastText(writes)).toBe("[dim]⚡[/] [dim]tok/s —[/]");
  });

  it("throttles writes while a response streams", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
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

  it("toggles the line off and back on", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
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
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    expect(line.toggle(ctx)).toBe(false);
    writes.length = 0;

    stream(line, ctx, clock, message, 2_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);

    expect(writes).toEqual([]);
  });

  it("ignores non-assistant messages", () => {
    const { ctx, writes } = makeCtx();
    const line = new TokenRateLine(() => 1_000);
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

    const line = new TokenRateLine(() => 1_000);
    const message = makeAssistantMessage();
    line.start(ctx);
    line.onMessageStart(ctx, makeMessageStart(message).message);
    line.onUpdate(ctx, makeTextUpdate(message, 10));
    line.onMessageEnd(ctx, makeMessageEnd(message, 10).message);

    expect(writes).toEqual([]);
  });
});
