import { describe, it } from "node:test";

import { classifyModelSwitch, providerFor } from "../../src/core/lookup.ts";
import { expect } from "../helpers/expect.ts";
import { makeFakeProvider } from "../helpers/fake-provider.ts";

const minimax = makeFakeProvider({ id: "minimax-cn" });
// A hypothetical second region that deliberately shares MiniMax's adapter.
const minimaxGlobal = makeFakeProvider({
  id: "minimax-global",
  providerIds: ["minimax-global"],
});
const opencodeGo = makeFakeProvider({ id: "opencode-go" });
const PROVIDERS = [minimax, minimaxGlobal, opencodeGo];

describe("providerFor", () => {
  it("finds the adapter that lists the model provider id", () => {
    expect(providerFor(PROVIDERS, "minimax-cn")).toBe(minimax);
    expect(providerFor(PROVIDERS, "opencode-go")).toBe(opencodeGo);
  });

  it("returns undefined for an unmapped or missing id", () => {
    expect(providerFor(PROVIDERS, "anthropic")).toBe(undefined);
    expect(providerFor(PROVIDERS, undefined)).toBe(undefined);
  });

  it("resolves every id an adapter claims", () => {
    const shared = makeFakeProvider({
      id: "shared",
      providerIds: ["vendor-cn", "vendor-global"],
    });
    expect(providerFor([shared], "vendor-cn")).toBe(shared);
    expect(providerFor([shared], "vendor-global")).toBe(shared);
  });
});

describe("classifyModelSwitch", () => {
  it("enters when moving into a supported provider", () => {
    expect(classifyModelSwitch(PROVIDERS, "anthropic", "opencode-go")).toBe(
      "enter",
    );
  });

  it("enters when the previous model is unknown (first pick in a session)", () => {
    expect(classifyModelSwitch(PROVIDERS, undefined, "minimax-cn")).toBe(
      "enter",
    );
  });

  it("leaves when moving out of a supported provider", () => {
    expect(classifyModelSwitch(PROVIDERS, "opencode-go", "anthropic")).toBe(
      "leave",
    );
  });

  it("leaves when nothing is selected afterwards", () => {
    expect(classifyModelSwitch(PROVIDERS, "opencode-go", undefined)).toBe(
      "leave",
    );
  });

  it("is a no-op when both sides map to the same adapter", () => {
    // Switching two models of one vendor must not clear the line nor spend a
    // request: the quota is account-wide.
    expect(classifyModelSwitch(PROVIDERS, "opencode-go", "opencode-go")).toBe(
      "noop",
    );
    expect(classifyModelSwitch(PROVIDERS, "minimax-cn", "minimax-cn")).toBe(
      "noop",
    );
  });

  it("treats two ids that share one adapter as the same account", () => {
    const shared = makeFakeProvider({
      id: "shared",
      providerIds: ["vendor-cn", "vendor-global"],
    });
    expect(classifyModelSwitch([shared], "vendor-cn", "vendor-global")).toBe(
      "noop",
    );
  });

  it("enters when crossing between two different supported providers", () => {
    expect(classifyModelSwitch(PROVIDERS, "minimax-cn", "opencode-go")).toBe(
      "enter",
    );
  });

  it("is a no-op when neither side is supported", () => {
    expect(classifyModelSwitch(PROVIDERS, "anthropic", "openai")).toBe("noop");
    expect(classifyModelSwitch(PROVIDERS, undefined, "anthropic")).toBe("noop");
    expect(classifyModelSwitch(PROVIDERS, undefined, undefined)).toBe("noop");
  });
});
