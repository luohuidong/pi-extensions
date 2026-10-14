import { afterEach, describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  classifyModelSwitch,
  isProviderActive,
  QuotaLine,
  shouldThrottle,
  THROTTLE_MS,
} from "../src/line.ts";
import { expect } from "./helpers/expect.ts";
import { makeUsage, makeWindow } from "./helpers/usage.ts";

const GO = { provider: "opencode-go" };
const GO_OTHER_MODEL = { provider: "opencode-go" };
const ANTHROPIC = { provider: "anthropic" };

const STATUS_KEY = "opencode-go-quota";

describe("isProviderActive", () => {
  it("is true only for the opencode-go provider", () => {
    expect(isProviderActive(GO)).toBe(true);
    expect(isProviderActive(ANTHROPIC)).toBe(false);
    expect(isProviderActive(undefined)).toBe(false);
  });
});

describe("classifyModelSwitch", () => {
  it("enters when moving into opencode-go", () => {
    expect(classifyModelSwitch(ANTHROPIC, GO)).toBe("enter");
  });

  it("enters when the previous model is unknown (first pick in a session)", () => {
    expect(classifyModelSwitch(undefined, GO)).toBe("enter");
  });

  it("leaves when moving out of opencode-go", () => {
    expect(classifyModelSwitch(GO, ANTHROPIC)).toBe("leave");
  });

  it("leaves when nothing is selected afterwards", () => {
    expect(classifyModelSwitch(GO, undefined)).toBe("leave");
  });

  it("is a no-op when both sides are opencode-go (switching Go models)", () => {
    // GLM → Kimi must not clear the line nor spend a request.
    expect(classifyModelSwitch(GO, GO_OTHER_MODEL)).toBe("noop");
  });

  it("is a no-op when neither side is opencode-go", () => {
    expect(classifyModelSwitch(ANTHROPIC, { provider: "openai" })).toBe("noop");
    expect(classifyModelSwitch(undefined, ANTHROPIC)).toBe("noop");
    expect(classifyModelSwitch(undefined, undefined)).toBe("noop");
  });
});

describe("shouldThrottle", () => {
  const now = 1_000_000;

  it("never throttles when the bar holds no content", () => {
    // e.g. after leaving the provider cleared the line: returning to it must
    // re-fetch instead of leaving the footer empty.
    expect(shouldThrottle(now, now, false)).toBe(false);
    expect(shouldThrottle(now - 1, now, false)).toBe(false);
  });

  it("never throttles when nothing has been fetched yet", () => {
    expect(shouldThrottle(0, now, true)).toBe(false);
  });

  it("throttles a fetch inside the window", () => {
    expect(shouldThrottle(now - 29_999, now, true)).toBe(true);
    expect(shouldThrottle(now, now, true)).toBe(true);
  });

  it("stops throttling once the window has elapsed", () => {
    expect(shouldThrottle(now - THROTTLE_MS, now, true)).toBe(false);
    expect(shouldThrottle(now - THROTTLE_MS - 1, now, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Controller tests
//
// `QuotaLine` reaches the network through the global `fetch` (via
// `fetchUsage`'s default parameter), so the harness swaps it out per test.
// Auth is always satisfied by the registry stub, which keeps the real
// `~/.pi/agent/auth.json` out of the test run; key resolution itself is
// covered by auth.test.ts.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Harness {
  ctx: ExtensionContext;
  statuses: (string | undefined)[];
  keys: string[];
  lastStatus(): string | undefined;
}

function makeCtx(
  model: { provider: string } | undefined,
  apiKey: string | undefined,
): Harness {
  const statuses: (string | undefined)[] = [];
  const keys: string[] = [];
  const ctx = {
    hasUI: true,
    model,
    modelRegistry: { getApiKeyForProvider: async () => apiKey },
    ui: {
      theme: {
        fg: (color: string, text: string) => `[${color}]${text}[/]`,
        bg: (color: string, text: string) => `[bg:${color}]${text}[/]`,
      },
      setStatus: (key: string, text: string | undefined) => {
        keys.push(key);
        statuses.push(text);
      },
    },
  } as unknown as ExtensionContext;

  return {
    ctx,
    statuses,
    keys,
    lastStatus: () => statuses[statuses.length - 1],
  };
}

/** Installs a stub `fetch`; returns a counter of how many times it ran. */
function stubFetch(handler: () => Response | Promise<Response>): {
  calls: number;
} {
  const counter = { calls: 0 };
  globalThis.fetch = (async () => {
    counter.calls += 1;
    return await handler();
  }) as unknown as typeof fetch;
  return counter;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A promise plus its resolver, for driving "response arrives later" cases. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("QuotaLine", () => {
  it("clears the status and never fetches when the provider is not active", async () => {
    const { ctx, statuses } = makeCtx(ANTHROPIC, "oc_sk_test");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));

    await new QuotaLine().refresh(ctx);

    expect(stubbed.calls).toBe(0);
    expect(statuses).toEqual([undefined]);
  });

  it("writes a loading placeholder, then the formatted line", async () => {
    const now = Date.parse("2026-10-14T11:12:10.000Z");
    const { ctx, keys, statuses, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() =>
      jsonResponse(
        makeUsage({
          rolling: makeWindow({
            percent: 12,
            resetsAt: new Date(now + 2 * 3_600_000 + 35 * 60_000).toISOString(),
          }),
          weekly: makeWindow({
            percent: 6,
            resetsAt: new Date(
              now + 4 * 86_400_000 + 12 * 3_600_000,
            ).toISOString(),
          }),
          monthly: makeWindow({
            percent: 3,
            resetsAt: new Date(now + 29 * 86_400_000 + 3_600_000).toISOString(),
          }),
        }),
      ),
    );

    await new QuotaLine().refresh(ctx, now);

    expect(statuses.length).toBe(2);
    expect(statuses[0]).toContain("loading…");
    // Positional order is the contract: rolling, weekly, monthly.
    expect(lastStatus()).toContain(
      "[dim]Go[/][dim]·[/][success]12%[/][dim]([/][dim]2h35m[/][dim])[/]",
    );
    expect(lastStatus()).toContain(
      "[dim]·[/][success]6%[/][dim]([/][dim]4d12h[/][dim])[/]",
    );
    expect(lastStatus()).toContain(
      "[dim]·[/][success]3%[/][dim]([/][dim]29d1h[/][dim])[/]",
    );
    expect(keys.every((k) => k === STATUS_KEY)).toBe(true);
  });

  it("maps a rejected key to the invalid-key placeholder", async () => {
    const { ctx, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() => jsonResponse({ error: "nope" }, 401));

    await new QuotaLine().refresh(ctx);
    expect(lastStatus()).toContain("invalid key");
  });

  it("maps a key without a Go plan to the no-subscription placeholder", async () => {
    const { ctx, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() => jsonResponse({ error: "EntitlementError" }, 403));

    await new QuotaLine().refresh(ctx);
    expect(lastStatus()).toContain("no Go subscription");
  });

  it("maps a payload without any usable percent to the no-data placeholder", async () => {
    const { ctx, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() => jsonResponse({ usage: {} }));

    await new QuotaLine().refresh(ctx);
    expect(lastStatus()).toContain("no quota data");
  });

  it("maps a transport failure to the error placeholder", async () => {
    const { ctx, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() => {
      throw new Error("network down");
    });

    await new QuotaLine().refresh(ctx);
    expect(lastStatus()).toContain("error");
  });

  it("throttles a second refresh inside the window", async () => {
    const now = 1_000_000;
    const { ctx, statuses } = makeCtx(GO, "oc_sk_test");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));
    const line = new QuotaLine();

    await line.refresh(ctx, now);
    expect(stubbed.calls).toBe(1);
    const afterFirst = statuses.length;

    await line.refresh(ctx, now + THROTTLE_MS - 1);
    expect(stubbed.calls).toBe(1);
    // Throttled means "leave the bar alone" — not even a loading placeholder.
    expect(statuses.length).toBe(afterFirst);

    await line.refresh(ctx, now + THROTTLE_MS);
    expect(stubbed.calls).toBe(2);
  });

  it("lets the manual command bypass the throttle", async () => {
    const now = 1_000_000;
    const { ctx } = makeCtx(GO, "oc_sk_test");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));
    const line = new QuotaLine();

    await line.refresh(ctx, now);
    await line.refreshNow(ctx, now + 1);
    expect(stubbed.calls).toBe(2);
  });

  it("re-fetches after a clear even inside the throttle window", async () => {
    // Leaving the provider clears the line; returning within 30s must not
    // leave the footer empty.
    const now = 1_000_000;
    const { ctx } = makeCtx(GO, "oc_sk_test");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));
    const line = new QuotaLine();

    await line.refresh(ctx, now);
    line.clear(ctx);
    await line.refresh(ctx, now + 1_000);
    expect(stubbed.calls).toBe(2);
  });

  it("discards a result that resolves after the line was cleared", async () => {
    const pending = deferred<Response>();
    const { ctx, statuses, lastStatus } = makeCtx(GO, "oc_sk_test");
    stubFetch(() => pending.promise);
    const line = new QuotaLine();

    const refresh = line.refresh(ctx, 1_000_000);
    // The user switches away while the request is still in flight.
    line.clear(ctx);
    pending.resolve(jsonResponse(makeUsage()));

    await refresh;

    // loading… → undefined, and nothing after the clear.
    expect(lastStatus()).toBe(undefined);
    expect(statuses.length).toBe(2);
  });

  it("exposes the snapshot the detail view renders", async () => {
    const now = 1_000_000;
    const { ctx } = makeCtx(GO, "oc_sk_test");
    stubFetch(() =>
      jsonResponse(makeUsage({ rolling: makeWindow({ percent: 42 }) })),
    );
    const line = new QuotaLine();

    expect(line.getSnapshot()).toBe(undefined);
    await line.refresh(ctx, now);

    const snapshot = line.getSnapshot();
    expect(snapshot?.fetchedAt).toBe(now);
    expect(snapshot?.quota.rolling.usedPct).toBe(42);
  });

  it("drops the snapshot on failure and on clear", async () => {
    const { ctx } = makeCtx(GO, "oc_sk_test");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));
    const line = new QuotaLine();

    await line.refresh(ctx, 1_000_000);
    expect(line.getSnapshot() === undefined).toBe(false);

    // A failing refresh must not leave the old numbers behind for the
    // detail view to print.
    stubbed.calls = 0;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await line.refresh(ctx, 1_000_000 + THROTTLE_MS);
    expect(line.getSnapshot()).toBe(undefined);

    await line.refreshNow(ctx, 1_000_000 + 2 * THROTTLE_MS);
    expect(line.getSnapshot()).toBe(undefined);
  });
});
