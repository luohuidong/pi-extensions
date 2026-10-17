import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { QuotaLine, THROTTLE_MS } from "../../src/core/line.ts";
import { expect } from "../helpers/expect.ts";
import { deferred, makeFakeProvider } from "../helpers/fake-provider.ts";

interface Harness {
  ctx: ExtensionContext;
  statuses: (string | undefined)[];
  setProvider(provider: string | undefined): void;
  lastStatus(): string | undefined;
}

function makeCtx(provider: string | undefined): Harness {
  const statuses: (string | undefined)[] = [];
  const holder = {
    hasUI: true,
    model: provider === undefined ? undefined : { provider },
    modelRegistry: { getApiKeyForProvider: async () => undefined },
    ui: {
      theme: {
        fg: (color: string, text: string) => `[${color}]${text}[/]`,
        bg: (color: string, text: string) => `[bg:${color}]${text}[/]`,
      },
      setStatus: (_key: string, text: string | undefined) => {
        statuses.push(text);
      },
    },
  };
  return {
    ctx: holder as unknown as ExtensionContext,
    statuses,
    setProvider(provider) {
      holder.model = provider === undefined ? undefined : { provider };
    },
    lastStatus: () => statuses[statuses.length - 1],
  };
}

function makeClock(start = 1_000_000): { now: number } {
  return { now: start };
}

describe("QuotaLine", () => {
  it("clears the status and never fetches when no provider is supported", async () => {
    const provider = makeFakeProvider({ id: "opencode-go" });
    const { ctx, lastStatus } = makeCtx("anthropic");
    const line = new QuotaLine([provider], () => 1_000_000);

    line.activate(ctx);
    await line.refresh(ctx);

    expect(provider.calls).toBe(0);
    expect(lastStatus()).toBe(undefined);
  });

  it("paints a loading placeholder, then the provider's line", async () => {
    const provider = makeFakeProvider({
      id: "opencode-go",
      render: async () => ({ text: "the line", detail: "the detail" }),
    });
    const { ctx, statuses, lastStatus } = makeCtx("opencode-go");
    const line = new QuotaLine([provider], () => 1_000_000);

    await line.refresh(ctx);

    expect(statuses.length).toBe(2);
    expect(statuses[0]).toContain("loading…");
    expect(lastStatus()).toBe("the line");
    expect(line.getDetail(ctx)).toBe("the detail");
  });

  it("never lets a stale result overwrite the newly active provider", async () => {
    const pending = deferred<{ text: string; detail?: string }>();
    const first = makeFakeProvider({
      id: "minimax-cn",
      render: () => pending.promise,
    });
    const second = makeFakeProvider({
      id: "opencode-go",
      render: async () => ({ text: "second: ok" }),
    });
    const harness = makeCtx("minimax-cn");
    const line = new QuotaLine([first, second], () => 1_000_000);

    // The first provider's request is still in flight…
    const inFlight = line.refresh(harness.ctx);
    // …when the user switches provider and the new line is painted.
    harness.setProvider("opencode-go");
    line.activate(harness.ctx);
    await line.refresh(harness.ctx);

    // The first response finally lands; it must land in its own map slot only.
    pending.resolve({ text: "first: ok" });
    await inFlight;

    expect(harness.lastStatus()).toBe("second: ok");
  });

  it("fetches two providers concurrently, each with its own in-flight guard", async () => {
    const p1 = deferred<{ text: string }>();
    const p2 = deferred<{ text: string }>();
    const first = makeFakeProvider({
      id: "minimax-cn",
      render: () => p1.promise,
    });
    const second = makeFakeProvider({
      id: "opencode-go",
      render: () => p2.promise,
    });
    const harness = makeCtx("minimax-cn");
    const line = new QuotaLine([first, second], () => 1_000_000);

    const a = line.refresh(harness.ctx);
    const again = line.refresh(harness.ctx); // same provider — deduped
    harness.setProvider("opencode-go");
    const b = line.refresh(harness.ctx);

    expect(a).toBe(again);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);

    p1.resolve({ text: "first: ok" });
    p2.resolve({ text: "second: ok" });
    await Promise.all([a, b]);

    expect(harness.lastStatus()).toBe("second: ok");
  });

  it("throttles a second refresh inside the window and leaves the bar alone", async () => {
    const now = 1_000_000;
    const provider = makeFakeProvider({ id: "opencode-go" });
    const harness = makeCtx("opencode-go");
    const clock = makeClock(now);
    const line = new QuotaLine([provider], () => clock.now);

    await line.refresh(harness.ctx);
    expect(provider.calls).toBe(1);
    const afterFirst = harness.statuses.length;

    await line.refresh(harness.ctx); // same instant — throttled
    expect(provider.calls).toBe(1);
    expect(harness.statuses.length).toBe(afterFirst);

    clock.now = now + THROTTLE_MS;
    await line.refresh(harness.ctx);
    expect(provider.calls).toBe(2);
  });

  it("serves a fresh cache without fetching or flashing loading", async () => {
    const provider = makeFakeProvider({ id: "opencode-go" });
    const harness = makeCtx("opencode-go");
    const clock = makeClock(1_000_000);
    const line = new QuotaLine([provider], () => clock.now);

    await line.refresh(harness.ctx);
    clock.now += 1_000;

    line.activate(harness.ctx);
    await line.refresh(harness.ctx);

    expect(provider.calls).toBe(1);
    expect(harness.lastStatus()).toBe("opencode-go: ok");
  });

  it("caches a failure placeholder and re-shows it inside the window", async () => {
    let outcome = "error";
    const provider = makeFakeProvider({
      id: "opencode-go",
      render: async () => ({ text: `opencode-go: ${outcome}` }),
    });
    const harness = makeCtx("opencode-go");
    const clock = makeClock(1_000_000);
    const line = new QuotaLine([provider], () => clock.now);

    await line.refresh(harness.ctx);
    expect(harness.lastStatus()).toBe("opencode-go: error");
    expect(line.getDetail(harness.ctx)).toBe(undefined);

    // Leave and come back inside the window: the placeholder is still fresh.
    harness.setProvider("anthropic");
    line.activate(harness.ctx);
    clock.now += 1_000;
    harness.setProvider("opencode-go");
    line.activate(harness.ctx);
    await line.refresh(harness.ctx);

    expect(provider.calls).toBe(1);
    expect(harness.lastStatus()).toBe("opencode-go: error");

    // Past the window it repaints loading and retries.
    outcome = "ok";
    clock.now += THROTTLE_MS;
    line.activate(harness.ctx);
    await line.refresh(harness.ctx);
    expect(provider.calls).toBe(2);
    expect(harness.lastStatus()).toBe("opencode-go: ok");
  });

  it("retains the cache while the provider is unsupported and restores it", async () => {
    const provider = makeFakeProvider({ id: "opencode-go" });
    const harness = makeCtx("opencode-go");
    const clock = makeClock(1_000_000);
    const line = new QuotaLine([provider], () => clock.now);

    await line.refresh(harness.ctx);

    harness.setProvider("anthropic");
    line.activate(harness.ctx);
    await line.refresh(harness.ctx);
    expect(harness.lastStatus()).toBe(undefined);

    clock.now += 1_000;
    harness.setProvider("opencode-go");
    line.activate(harness.ctx);
    await line.refresh(harness.ctx);

    expect(provider.calls).toBe(1);
    expect(harness.lastStatus()).toBe("opencode-go: ok");
  });

  it("reports whether a fetch is in flight", async () => {
    const pending = deferred<{ text: string }>();
    const provider = makeFakeProvider({
      id: "opencode-go",
      render: () => pending.promise,
    });
    const harness = makeCtx("opencode-go");
    const line = new QuotaLine([provider], () => 1_000_000);

    expect(line.isFetching(harness.ctx)).toBe(false);
    const inFlight = line.refresh(harness.ctx);
    expect(line.isFetching(harness.ctx)).toBe(true);

    pending.resolve({ text: "done" });
    await inFlight;
    expect(line.isFetching(harness.ctx)).toBe(false);
  });

  it("survives a provider that throws, without leaking the exception", async () => {
    const provider = makeFakeProvider({
      id: "opencode-go",
      render: async () => {
        throw new Error("boom");
      },
    });
    const harness = makeCtx("opencode-go");
    const line = new QuotaLine([provider], () => 1_000_000);

    await line.refresh(harness.ctx);

    expect(harness.lastStatus()).toContain("loading…");
    expect(line.getDetail(harness.ctx)).toBe(undefined);
  });
});
