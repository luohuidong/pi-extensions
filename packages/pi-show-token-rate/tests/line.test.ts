/**
 * Status-line controller: streaming, throttling, settling, and the toggle.
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

/** Feed a response of `steps` updates, `perStep` tokens each, every 100ms. */
function stream(
  line: TokenRateLine,
  ctx: ExtensionContext,
  clock: { now: number },
  message: ReturnType<typeof makeAssistantMessage>,
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

    // 10 tokens every 100ms; the trailing window sees 40 tokens over 400ms.
    stream(line, ctx, clock, makeAssistantMessage(), 1_000, 5, 10);

    expect(lastText(writes)).toBe("[dim]⚡[/] [success]100[/] [dim]tok/s[/]");
  });

  it("keeps the previous line until a rate can be measured", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    const settled = lastText(writes);

    // New response: a single delta opens the window but cannot produce a rate.
    clock.now = 5_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    line.onUpdate(ctx, makeTextUpdate(message, 5));
    assert.ok(settled);
    expect(lastText(writes)).toBe(settled);
  });

  it("settles on the last response rate, then appends the average", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 5, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 50).message);
    // One response has no average yet.
    expect(lastText(writes)).toBe("[dim]⚡[/] [success]100[/] [dim]tok/s[/]");

    stream(line, ctx, clock, message, 2_000, 3, 5);
    line.onMessageEnd(ctx, makeMessageEnd(message, 15).message);
    // Response 1 measured 40 tokens over 400ms, response 2 measured 10 over
    // 200ms: the session average is 50 tokens / 600ms ≈ 83 tok/s, while the
    // newest response alone streamed at 50 tok/s.
    expect(lastText(writes)).toBe(
      "[dim]⚡[/] [success]50[/] [dim]tok/s[/][dim] · avg [/][dim]83[/]",
    );
  });

  it("marks rates that are estimated from streamed characters", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // Provider reports no usage: fall back to chars ÷ 4 (400 chars → 100).
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 3; i += 1) {
      clock.now = 1_000 + i * 100;
      line.onUpdate(ctx, makeTextUpdate(message, 0, "x".repeat(400)));
    }
    // 100 tokens per 100ms burst, painted once the throttle allows it.
    expect(lastText(writes)).toBe(
      "[dim]⚡[/] [dim]~[/][success]1000[/] [dim]tok/s[/]",
    );

    clock.now = 1_400;
    line.onMessageEnd(ctx, makeMessageEnd(message, 0).message);
    expect(line.summary().last?.source).toBe("estimate");
  });

  it("keeps the tilde and the rate when usage appears mid-stream", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // No usage while streaming: 100 estimated tokens per 200ms burst.
    clock.now = 1_000;
    line.onMessageStart(ctx, makeMessageStart(message).message);
    for (let i = 1; i <= 3; i += 1) {
      clock.now = 1_000 + i * 200;
      line.onUpdate(ctx, makeTextUpdate(message, 0, "x".repeat(400)));
    }
    expect(lastText(writes)).toBe(
      "[dim]⚡[/] [dim]~[/][success]500[/] [dim]tok/s[/]",
    );

    // Usage lands mid-stream and outruns the estimate. The window stays on
    // the estimate scale, so the live rate neither spikes nor drops the tilde.
    clock.now = 1_800;
    line.onUpdate(ctx, makeTextUpdate(message, 900, "x"));
    expect(lastText(writes)).toBe(
      "[dim]⚡[/] [dim]~[/][success]500[/] [dim]tok/s[/]",
    );

    // On message_end the reported count wins, and the tilde goes away.
    clock.now = 2_000;
    line.onMessageEnd(ctx, makeMessageEnd(message, 900).message);
    expect(lastText(writes)).toBe("[dim]⚡[/] [success]1125[/] [dim]tok/s[/]");
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

    // 30 updates over 300ms; the 150ms throttle allows at most three writes.
    const painted = writes.filter((write) => write.text !== undefined);
    assert.ok(
      painted.length <= 3,
      `expected <= 3 writes, got ${painted.length}`,
    );
    assert.ok(painted.length >= 1);
  });

  it("toggles the line off and back on", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    const painted = lastText(writes);
    assert.ok(painted);

    expect(line.toggle(ctx)).toBe(false);
    expect(lastText(writes)).toBeUndefined();

    // Updates while hidden stay hidden…
    stream(line, ctx, clock, message, 2_000, 3, 10);
    expect(lastText(writes)).toBeUndefined();

    expect(line.toggle(ctx)).toBe(true);
    assert.notStrictEqual(lastText(writes), undefined);
  });

  it("clears collected statistics on reset()", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    stream(line, ctx, clock, message, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 30).message);
    expect(line.summary().count).toBe(1);

    line.reset(ctx);
    expect(line.summary().count).toBe(0);
    expect(lastText(writes)).toBe("[dim]⚡[/] [dim]tok/s —[/]");
  });

  it("drops an aborted response instead of scoring a truncated window", () => {
    const { ctx, writes } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const message = makeAssistantMessage();

    // One complete response first, so there is a settled line to fall back to.
    stream(line, ctx, clock, message, 1_000, 5, 10);
    line.onMessageEnd(ctx, makeMessageEnd(message, 50).message);
    expect(line.summary().count).toBe(1);
    const settled = lastText(writes);
    assert.ok(settled);
    expect(settled).toBe("[dim]⚡[/] [success]100[/] [dim]tok/s[/]");

    // ESC mid-stream: pi still emits message_end, at a faster live rate, so a
    // repaint to the previous settled value is observable.
    const aborted = makeAssistantMessage({ stopReason: "aborted" });
    stream(line, ctx, clock, aborted, 2_000, 3, 20);
    line.onMessageEnd(ctx, makeMessageEnd(aborted).message);

    expect(line.summary().count).toBe(1);
    expect(lastText(writes)).toBe(settled);
  });

  it("drops a response that ended in an error", () => {
    const { ctx } = makeCtx();
    const clock = { now: 0 };
    const line = new TokenRateLine(() => clock.now);
    const failed = makeAssistantMessage({ stopReason: "error" });

    stream(line, ctx, clock, failed, 1_000, 3, 10);
    line.onMessageEnd(ctx, makeMessageEnd(failed).message);

    expect(line.summary().count).toBe(0);
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

    // Nothing left to clear: the row was blank before the stream and stayed
    // blank, so the controller does not ask the TUI to redraw it.
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
    expect(line.summary().count).toBe(0);
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
    line.onMessageStart(ctx, message);
    line.onUpdate(ctx, makeTextUpdate(message, 10));
    line.onMessageEnd(ctx, makeMessageEnd(message, 10).message);

    expect(writes).toEqual([]);
  });
});
