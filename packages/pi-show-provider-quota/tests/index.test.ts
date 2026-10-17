import { afterEach, describe, it } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import register from "../src/index.ts";
import { expect } from "./helpers/expect.ts";
import { makeUsage } from "./helpers/usage.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Harness {
  ctx: ExtensionContext;
  statuses: (string | undefined)[];
  notifies: { message: string; level: string | undefined }[];
  setProvider(provider: string | undefined): void;
  fire(event: string, payload?: unknown): void;
  command(): Promise<void>;
  lastStatus(): string | undefined;
  lastNotify(): { message: string; level: string | undefined } | undefined;
}

type AnyHandler = (event: unknown, ctx: ExtensionContext) => unknown;

function setup(provider: string | undefined): Harness {
  const handlers = new Map<string, AnyHandler>();
  let commandHandler: (() => Promise<void>) | undefined;

  const pi = {
    on(event: string, handler: AnyHandler) {
      handlers.set(event, handler);
    },
    registerCommand(
      _name: string,
      spec: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
    ) {
      commandHandler = () =>
        spec.handler("", ctxHolder as unknown as ExtensionContext);
    },
  } as unknown as ExtensionAPI;

  register(pi);

  const statuses: (string | undefined)[] = [];
  const notifies: { message: string; level: string | undefined }[] = [];
  const ctxHolder = {
    hasUI: true,
    model: provider === undefined ? undefined : { provider },
    modelRegistry: { getApiKeyForProvider: async () => "oc_sk_test" },
    ui: {
      theme: {
        fg: (color: string, text: string) => `[${color}]${text}[/]`,
        bg: (color: string, text: string) => `[bg:${color}]${text}[/]`,
      },
      setStatus: (_key: string, text: string | undefined) => {
        statuses.push(text);
      },
      notify: (message: string, level?: string) => {
        notifies.push({ message, level });
      },
    },
  };

  return {
    ctx: ctxHolder as unknown as ExtensionContext,
    statuses,
    notifies,
    setProvider(value) {
      ctxHolder.model = value === undefined ? undefined : { provider: value };
    },
    fire(event, payload = {}) {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`no handler for ${event}`);
      void handler(payload, ctxHolder as unknown as ExtensionContext);
    },
    async command() {
      if (!commandHandler) throw new Error("command was not registered");
      await commandHandler();
    },
    lastStatus: () => statuses[statuses.length - 1],
    lastNotify: () => notifies[notifies.length - 1],
  };
}

/** Flushes the fire-and-forget refresh chain started by an event handler. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("extension wiring", () => {
  it("paints loading and then the quota line on session_start", async () => {
    const harness = setup("opencode-go");
    stubFetch(() => jsonResponse(makeUsage({ rolling: undefined })));

    harness.fire("session_start");
    await flush();

    expect(harness.statuses[0]).toContain("loading…");
    expect(harness.lastStatus()).toContain("[dim]Go[/]");
  });

  it("does nothing at all on a same-provider model switch", async () => {
    const harness = setup("opencode-go");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));

    harness.fire("session_start");
    await flush();
    expect(stubbed.calls).toBe(1);
    const afterStart = harness.statuses.length;

    harness.fire("model_select", {
      previousModel: { provider: "opencode-go" },
      model: { provider: "opencode-go" },
    });
    await flush();

    expect(stubbed.calls).toBe(1);
    expect(harness.statuses.length).toBe(afterStart);
  });

  it("clears the row when the model leaves the supported provider", async () => {
    const harness = setup("opencode-go");
    stubFetch(() => jsonResponse(makeUsage()));

    harness.fire("session_start");
    await flush();

    harness.setProvider("anthropic");
    harness.fire("model_select", {
      previousModel: { provider: "opencode-go" },
      model: { provider: "anthropic" },
    });
    await flush();

    expect(harness.lastStatus()).toBe(undefined);
  });

  it("fetches when the model enters the supported provider", async () => {
    const harness = setup("anthropic");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));

    harness.setProvider("opencode-go");
    harness.fire("model_select", {
      previousModel: { provider: "anthropic" },
      model: { provider: "opencode-go" },
    });
    await flush();

    expect(stubbed.calls).toBe(1);
    expect(harness.lastStatus()).toContain("[dim]Go[/]");
  });
});

describe("/show-provider-quota", () => {
  it("prints the cached breakdown without fetching again", async () => {
    const harness = setup("opencode-go");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));

    harness.fire("session_start");
    await flush();
    expect(stubbed.calls).toBe(1);

    await harness.command();

    expect(stubbed.calls).toBe(1);
    expect(harness.lastNotify()?.message).toContain(
      "OpenCode Go usage (used %)",
    );
    expect(harness.lastNotify()?.level).toBe("info");
  });

  it("joins an in-flight request and prints the fresh breakdown", async () => {
    const harness = setup("opencode-go");
    const pending = deferred<Response>();
    const stubbed = stubFetch(() => pending.promise);

    harness.fire("session_start");
    await flush();
    expect(stubbed.calls).toBe(1);

    const command = harness.command();
    // The command should announce that it is waiting, not fire a second request.
    expect(harness.lastNotify()?.message).toContain("querying");
    expect(stubbed.calls).toBe(1);

    pending.resolve(jsonResponse(makeUsage({ rolling: undefined })));
    await command;

    expect(stubbed.calls).toBe(1);
    expect(harness.lastNotify()?.message).toContain(
      "OpenCode Go usage (used %)",
    );
  });

  it("warns and stays silent when the provider has no quota support", async () => {
    const harness = setup("anthropic");
    const stubbed = stubFetch(() => jsonResponse(makeUsage()));

    await harness.command();

    expect(stubbed.calls).toBe(0);
    expect(harness.lastNotify()?.level).toBe("warning");
    expect(harness.lastNotify()?.message).toContain("no quota support");
  });

  it("warns instead of printing stale numbers when the fetch failed", async () => {
    const harness = setup("opencode-go");
    stubFetch(() => jsonResponse({ error: "boom" }, 500));

    harness.fire("session_start");
    await flush();
    expect(harness.lastStatus()).toContain("error");

    await harness.command();

    expect(harness.lastNotify()?.level).toBe("warning");
    expect(harness.lastNotify()?.message).toContain("no quota data");
  });
});
