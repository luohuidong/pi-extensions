import { describe, it } from "node:test";

import { fetchUsage } from "../src/api.ts";
import { expect } from "./helpers/expect.ts";

const ENDPOINT = "https://opencode.ai/zen/go/v1/usage";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** Builds a stub `fetch` that records its call and returns a canned response. */
function stubFetch(handler: (call: Call) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return await handler(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchUsage", () => {
  it("hits the official endpoint with a Bearer key", async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({ usage: {} }));
    await fetchUsage("oc_sk_test", impl);

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(ENDPOINT);
    expect(
      (calls[0]?.init?.headers as Record<string, string> | undefined)
        ?.Authorization,
    ).toBe("Bearer oc_sk_test");
  });

  it("returns the parsed body on 200", async () => {
    const body = {
      usage: {
        rolling: {
          status: "ok",
          percent: 0,
          resetsAt: "2026-10-14T13:21:30.000Z",
        },
        weekly: {
          status: "ok",
          percent: 6,
          resetsAt: "2026-10-19T00:00:00.000Z",
        },
        monthly: {
          status: "ok",
          percent: 3,
          resetsAt: "2026-11-12T12:55:55.000Z",
        },
      },
    };
    const { impl } = stubFetch(() => jsonResponse(body));
    const result = await fetchUsage("k", impl);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.body).toEqual(body);
  });

  it("maps 401 to unauthorized", async () => {
    const { impl } = stubFetch(() => jsonResponse({ error: "nope" }, 401));
    expect((await fetchUsage("k", impl)).kind).toBe("unauthorized");
  });

  it("maps 403 to no-subscription (valid key without a Go plan)", async () => {
    const { impl } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "EntitlementError",
              message: "OpenCode Go subscription required.",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    );
    expect((await fetchUsage("k", impl)).kind).toBe("no-subscription");
  });

  it("maps any other non-2xx status to error", async () => {
    for (const status of [400, 429, 500, 503]) {
      const { impl } = stubFetch(() => new Response("boom", { status }));
      expect((await fetchUsage("k", impl)).kind).toBe("error");
    }
  });

  it("maps a transport failure to error instead of throwing", async () => {
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect((await fetchUsage("k", impl)).kind).toBe("error");
  });

  it("maps an unparseable body to error", async () => {
    const { impl } = stubFetch(
      () =>
        new Response("not json {", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    expect((await fetchUsage("k", impl)).kind).toBe("error");
  });
});
