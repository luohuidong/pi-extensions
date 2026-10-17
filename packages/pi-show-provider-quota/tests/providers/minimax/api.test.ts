import { afterEach, describe, it } from "node:test";

import { fetchQuota } from "../../../src/providers/minimax/api.ts";
import { expect } from "../../helpers/expect.ts";
import { makeModel } from "../../helpers/models.ts";

const ENDPOINT = "https://api.minimaxi.com/v1/token_plan/remains";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): {
  calls: Call[];
} {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return await handler(call);
  }) as unknown as typeof fetch;
  return { calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchQuota (MiniMax)", () => {
  it("hits the Token Plan endpoint with the provided Authorization header", async () => {
    const { calls } = stubFetch(() => jsonResponse({ model_remains: [] }));
    await fetchQuota("Bearer sk-cp-test");

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(ENDPOINT);
    expect(
      (calls[0]?.init?.headers as Record<string, string> | undefined)
        ?.Authorization,
    ).toBe("Bearer sk-cp-test");
  });

  it("returns the model_remains array on 200", async () => {
    const body = { model_remains: [makeModel()] };
    stubFetch(() => jsonResponse(body));
    expect(await fetchQuota("Bearer k")).toEqual(body.model_remains);
  });

  it("returns null on any non-2xx status", async () => {
    for (const status of [400, 401, 403, 500]) {
      stubFetch(() => new Response("nope", { status }));
      expect(await fetchQuota("Bearer k")).toBeNull();
    }
  });

  it("returns null on a transport failure instead of throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await fetchQuota("Bearer k")).toBeNull();
  });

  it("returns null on an unparseable body", async () => {
    stubFetch(
      () =>
        new Response("not json {", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    expect(await fetchQuota("Bearer k")).toBeNull();
  });
});
