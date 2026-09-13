import { afterEach, describe, it } from "node:test";

import { resolveAuthHeader } from "../src/auth.ts";
import { expect } from "./helpers/expect.ts";

describe("resolveAuthHeader", () => {
  const original = process.env.MINIMAX_TOKEN_PLAN_API_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MINIMAX_TOKEN_PLAN_API_KEY;
    } else {
      process.env.MINIMAX_TOKEN_PLAN_API_KEY = original;
    }
  });

  it("returns null when the env var is unset", () => {
    delete process.env.MINIMAX_TOKEN_PLAN_API_KEY;
    expect(resolveAuthHeader()).toBeNull();
  });

  it("returns null when the env var is empty", () => {
    process.env.MINIMAX_TOKEN_PLAN_API_KEY = "";
    expect(resolveAuthHeader()).toBeNull();
  });

  it("returns a Bearer header when the env var is set", () => {
    process.env.MINIMAX_TOKEN_PLAN_API_KEY = "sk-cp-test";
    expect(resolveAuthHeader()).toBe("Bearer sk-cp-test");
  });
});
